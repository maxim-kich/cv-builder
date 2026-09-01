import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOAuthTokenVerifier, CV_SCOPES } from "../server/auth";
import { buildApp } from "../server/app";
import type { AppConfig, OAuthConfig } from "../server/config";
import { createStorage } from "../server/storage";

const issuer = "https://identity.example.test/";
const audience = "https://cv-builder.example.test/mcp";
const subject = "auth0|maxim";

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const item = Array.isArray(result.content) ? result.content.find((entry) => entry.type === "text") : undefined;
  return item && "text" in item ? item.text : "";
}

describe("OAuth-protected MCP", () => {
  let app: FastifyInstance;
  let directory: string;
  let origin: string;
  let privateKey: CryptoKey;
  let oauth: OAuthConfig;

  async function token(options: {
    scopes?: string[];
    tokenSubject?: string;
    tokenAudience?: string;
    expiresIn?: number;
    jti?: string;
  } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: (options.scopes ?? Object.values(CV_SCOPES)).join(" ") })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(options.tokenAudience ?? audience)
      .setSubject(options.tokenSubject ?? subject)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresIn ?? 300))
      .setJti(options.jti ?? crypto.randomUUID())
      .sign(privateKey);
  }

  async function tokenWithoutRequiredClaims() {
    return new SignJWT({ scope: CV_SCOPES.read })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .sign(privateKey);
  }

  async function clientFor(accessToken: string) {
    const client = new Client({ name: "oauth-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    await client.connect(transport);
    return client;
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cv-builder-oauth-test-"));
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";
    oauth = {
      issuer,
      audience,
      jwksUrl: "https://identity.example.test/.well-known/jwks.json",
      allowedSubjects: new Set([subject]),
      algorithms: ["RS256"],
      maxTokenLifetimeSeconds: 600,
      revokedTokenIds: new Set(["revoked-token"]),
    };
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 5173,
      databaseUrl: `sqlite:${join(directory, "test.sqlite")}`,
      apiToken: "legacy-static-token",
      oauth,
      publicUrl: "https://cv-builder.example.test",
      seedFile: undefined,
      allowQuit: false,
      isProduction: false,
    };
    app = await buildApp({
      config,
      storage: createStorage(config.databaseUrl),
      serveFrontend: false,
      logger: false,
      oauthVerifier: createOAuthTokenVerifier(oauth, { getKey: createLocalJWKSet({ keys: [publicJwk] }) }),
    });
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("publishes RFC 9728 protected-resource discovery", async () => {
    for (const url of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        resource: audience,
        authorization_servers: [issuer],
        scopes_supported: Object.values(CV_SCOPES),
      });
    }
  });

  it("returns an OAuth discovery challenge when MCP initialization is unauthenticated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it.each([
    ["expired", () => token({ expiresIn: -60 })],
    ["wrong audience", () => token({ tokenAudience: "https://valeria.example.test/mcp" })],
    ["wrong subject", () => token({ tokenSubject: "auth0|valeria" })],
    ["revoked", () => token({ jti: "revoked-token" })],
    ["overlong", () => token({ expiresIn: 1_200 })],
    ["missing required claims", () => tokenWithoutRequiredClaims()],
  ])("rejects %s access tokens", async (_name, makeToken) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cvs",
      headers: { authorization: `Bearer ${await makeToken()}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("error=\"invalid_token\"");
  });

  it("advertises per-tool auth and rejects an under-scoped tool call", async () => {
    const client = await clientFor(await token({ scopes: [CV_SCOPES.read] }));
    const tools = await client.listTools();
    const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));
    expect(byName.list_cvs._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: [CV_SCOPES.read] }]);
    expect(byName.create_cv.annotations?.readOnlyHint).toBe(false);
    expect(byName.update_cv.annotations?.destructiveHint).toBe(true);
    expect(byName.delete_cv.annotations?.destructiveHint).toBe(true);

    const denied = await client.callTool({ name: "create_cv", arguments: { title: "Denied" } });
    expect(denied.isError).toBe(true);
    expect(denied._meta?.["mcp/www_authenticate"]).toBeDefined();
    expect(textResult(denied)).toContain(CV_SCOPES.write);
    await client.close();
  });

  it("initializes MCP and exercises every CV tool with correctly scoped OAuth", async () => {
    const client = await clientFor(await token());
    expect((await client.callTool({ name: "list_cvs", arguments: {} })).isError).not.toBe(true);

    const createdResult = await client.callTool({
      name: "create_cv",
      arguments: { title: "OAuth CV" },
    });
    const created = JSON.parse(textResult(createdResult)) as { id: string; revision: number };
    expect(created.revision).toBe(1);

    const fetched = await client.callTool({ name: "get_cv", arguments: { id: created.id } });
    expect(textResult(fetched)).toContain("OAuth CV");

    const updated = await client.callTool({
      name: "update_cv",
      arguments: { id: created.id, title: "Updated OAuth CV", expectedRevision: 1 },
    });
    expect(JSON.parse(textResult(updated)).revision).toBe(2);

    const exported = await client.callTool({
      name: "export_cv",
      arguments: { id: created.id, format: "pdf" },
    });
    expect(exported.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "resource", resource: expect.objectContaining({ mimeType: "application/pdf" }) }),
    ]));

    const deleted = await client.callTool({ name: "delete_cv", arguments: { id: created.id } });
    expect(JSON.parse(textResult(deleted))).toEqual({ deleted: true, id: created.id });
    await client.close();
  });
});
