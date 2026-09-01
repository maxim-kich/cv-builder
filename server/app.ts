import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createEmptyResume } from "../src/cvStore";
import { outputFilename, parseResumeMarkdown, resumeToMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";
import type { ResumeData } from "../src/types";
import type { AppConfig } from "./config";
import {
  ALL_CV_SCOPES,
  bearerToken,
  createOAuthTokenVerifier,
  localAccessContext,
  missingScopes,
  oauthChallenge,
  sessionAccessContext,
  sessionValue,
  tokensEqual,
  type AccessContext,
  type OAuthTokenVerifier,
} from "./auth";
import { createMcpServer } from "./mcp";
import { createOpenApiDocument } from "./openapi";
import { createCvSchema, updateCvSchema } from "./schemas";
import type { CvStorage } from "./storage";

interface BuildAppOptions {
  config: AppConfig;
  storage: CvStorage;
  serveFrontend?: boolean;
  logger?: boolean;
  oauthVerifier?: OAuthTokenVerifier;
}

async function loadSeed(seedFile: string | undefined): Promise<ResumeData> {
  if (!seedFile) return createEmptyResume();
  try {
    return parseResumeMarkdown(await readFile(seedFile, "utf8"));
  } catch {
    return createEmptyResume();
  }
}

export async function buildApp({ config, storage, serveFrontend = true, logger = true, oauthVerifier }: BuildAppOptions) {
  const app = Fastify({ logger });
  const resourceMetadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  const verifier = oauthVerifier ?? (config.oauth ? createOAuthTokenVerifier(config.oauth) : undefined);
  const accessContexts = new WeakMap<FastifyRequest, AccessContext>();
  await app.register(cookie);
  await storage.init();

  const existing = await storage.list();
  if (existing.length === 0) {
    const seed = await loadSeed(config.seedFile);
    if (config.seedFile || seed.name) {
      await storage.create({ title: seed.name || "Untitled", resume: seed, hideLanguageDots: false });
    }
  }

  app.addHook("onClose", async () => storage.close());
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    return payload;
  });

  const rejectAuthentication = (
    reply: FastifyReply,
    error: "invalid_token" | "insufficient_scope",
    message: string,
    scopes: readonly string[] = [],
  ) => {
    if (config.oauth) reply.header("WWW-Authenticate", oauthChallenge(resourceMetadataUrl, error, message, scopes));
    return reply.code(error === "insufficient_scope" ? 403 : 401).send({ error, message });
  };

  const authenticate = (requiredScopes: readonly string[] = []) => async (request: FastifyRequest, reply: FastifyReply) => {
    let context: AccessContext | undefined;
    const token = bearerToken(request);
    if (config.apiToken && tokensEqual(token, config.apiToken)) {
      context = localAccessContext(config.apiToken);
    } else if (token && verifier) {
      try {
        context = await verifier.verify(token);
      } catch {
        return rejectAuthentication(reply, "invalid_token", "The access token is invalid, expired, revoked, or intended for another deployment.");
      }
    } else if (config.apiToken && tokensEqual(request.cookies.cv_builder_session, sessionValue(config.apiToken))) {
      context = sessionAccessContext(config.apiToken);
    } else if (!config.apiToken && !config.oauth) {
      context = localAccessContext();
    }
    if (!context) {
      return rejectAuthentication(reply, "invalid_token", "A valid OAuth token, local agent token, or browser session is required.");
    }
    const missing = missingScopes(context.authInfo, requiredScopes);
    if (missing.length > 0) {
      return rejectAuthentication(reply, "insufficient_scope", `Required scope: ${missing.join(" ")}.`, requiredScopes);
    }
    accessContexts.set(request, context);
  };

  app.get("/api/v1/health", async () => ({
    ok: true,
    storage: storage.kind,
    authRequired: Boolean(config.apiToken || config.oauth),
    authMethods: [config.oauth ? "oauth2" : undefined, config.apiToken ? "static_bearer" : undefined].filter(Boolean),
    canQuit: config.allowQuit,
    apiVersion: "v1",
    mcpEndpoint: `${config.publicUrl}/mcp`,
  }));

  app.get("/api/v1/openapi.json", async () => createOpenApiDocument(config.publicUrl));

  const protectedResourceMetadata = () => config.oauth ? {
    resource: config.oauth.audience,
    authorization_servers: [config.oauth.issuer],
    scopes_supported: ALL_CV_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "CV Builder",
    resource_documentation: `${config.publicUrl}/docs/chatgpt-plugin`,
    resource_policy_uri: `${config.publicUrl}/privacy`,
  } : undefined;

  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    app.get(path, async (_request, reply) => {
      const metadata = protectedResourceMetadata();
      return metadata ?? reply.code(404).send({ error: "oauth_not_configured" });
    });
  }

  app.get("/privacy", async (_request, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>CV Builder Privacy</title><body><main><h1>CV Builder privacy</h1>
<p>This private deployment stores CV content in its own PostgreSQL database. Its operator controls retention and backups.</p>
<p>When you use the ChatGPT plugin or another MCP client, requested CV data is sent to that client to fulfill your request. OAuth access tokens are validated but are not stored by CV Builder. Database credentials are never returned by any tool.</p>
<p>Use the web interface to review or delete CVs. Contact the deployment operator for access, export, deletion, or recovery requests.</p>
</main></body></html>`));

  app.get("/terms", async (_request, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>CV Builder Terms</title><body><main><h1>CV Builder terms</h1>
<p>This is a private, self-hosted CV management service. Only the deployment owner may authorize access. Review and confirm write or delete actions before execution.</p>
</main></body></html>`));

  app.get("/docs/chatgpt-plugin", async (_request, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>CV Builder MCP</title><body><main><h1>CV Builder MCP</h1>
<p>Connect an OAuth-capable MCP client to <code>${config.publicUrl}/mcp</code>. Available scopes are <code>${ALL_CV_SCOPES.join(" ")}</code>.</p>
<p>Read operations list and inspect CVs; write operations create and update them; export renders Markdown or PDF; delete permanently removes a CV.</p>
</main></body></html>`));

  app.post("/api/v1/session", async (request, reply) => {
    if (!config.apiToken) return { ok: true, authRequired: false };
    const token = typeof request.body === "object" && request.body && "token" in request.body
      ? String((request.body as { token: unknown }).token)
      : "";
    if (!tokensEqual(token, config.apiToken)) return reply.code(401).send({ error: "invalid_token" });
    reply.setCookie("cv_builder_session", sessionValue(config.apiToken), {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.publicUrl.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true, authRequired: true };
  });

  app.delete("/api/v1/session", async (_request, reply) => {
    reply.clearCookie("cv_builder_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/v1/cvs", { preHandler: authenticate(["cvs:read"]) }, async () => ({ items: await storage.list() }));

  app.post("/api/v1/cvs", { preHandler: authenticate(["cvs:write"]) }, async (request, reply) => {
    const parsed = createCvSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const resume = parsed.data.markdown ? parseResumeMarkdown(parsed.data.markdown) : parsed.data.resume ?? createEmptyResume();
    const cv = await storage.create({ title: parsed.data.title, resume, hideLanguageDots: parsed.data.hideLanguageDots });
    return reply.code(201).send(cv);
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate(["cvs:read"]) }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    return cv ?? reply.code(404).send({ error: "not_found" });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate(["cvs:write"]) }, async (request, reply) => {
    const parsed = updateCvSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const result = await storage.update(request.params.id, {
      title: parsed.data.title,
      resume: parsed.data.markdown ? parseResumeMarkdown(parsed.data.markdown) : parsed.data.resume,
      hideLanguageDots: parsed.data.hideLanguageDots,
      expectedRevision: parsed.data.expectedRevision,
    });
    if (result.status === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.status === "conflict") return reply.code(409).send({ error: "revision_conflict", current: result.cv });
    return result.cv;
  });

  app.delete<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate(["cvs:delete"]) }, async (request, reply) => {
    if (!await storage.delete(request.params.id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id/markdown", { preHandler: authenticate(["cvs:export"]) }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    if (!cv) return reply.code(404).send({ error: "not_found" });
    const filename = `${cv.title.replace(/[^a-z0-9_-]+/gi, "-") || "cv"}.md`;
    return reply.type("text/markdown; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send(resumeToMarkdown(cv.resume));
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id/pdf", { preHandler: authenticate(["cvs:export"]) }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    if (!cv) return reply.code(404).send({ error: "not_found" });
    const pdf = await renderResumeToBuffer(cv.resume, { showLanguageDots: !cv.hideLanguageDots });
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="${outputFilename(cv.resume)}"`).send(pdf);
  });

  app.all("/mcp", { preHandler: authenticate() }, async (request, reply) => {
    if (request.method !== "POST") {
      return reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    }
    const server = createMcpServer(storage, config.publicUrl, resourceMetadataUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const context = accessContexts.get(request);
    if (context) (request.raw as typeof request.raw & { auth?: AuthInfo }).auth = context.authInfo;
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      request.log.error(error, "MCP request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    }
  });

  app.post("/api/quit", async (_request, reply) => {
    if (!config.allowQuit) return reply.code(403).send({ error: "disabled" });
    reply.send({ ok: true, quitting: true });
    setTimeout(() => void app.close().finally(() => process.exit(0)), 50).unref();
  });

  if (serveFrontend) {
    if (config.isProduction) {
      const dist = resolve("dist");
      await access(dist);
      await app.register(fastifyStatic, { root: dist, wildcard: false });
      app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
    } else {
      await app.register(middie);
      const { createServer } = await import("vite");
      const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use((request, response, next) => {
        if (request.url?.startsWith("/api/") || request.url === "/mcp") return next();
        return vite.middlewares(request, response, next);
      });
      app.addHook("onClose", async () => vite.close());
    }
  }

  return app;
}
