import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/app";
import type { AppConfig } from "../server/config";
import { createStorage } from "../server/storage";
import { createEmptyResume, type CvDocument } from "../src/cvStore";

describe("CV API", () => {
  let app: FastifyInstance;
  let directory: string;
  let origin: string;
  const token = "test-token-that-is-long-enough";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cv-builder-test-"));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 5173,
      databaseUrl: `sqlite:${join(directory, "test.sqlite")}`,
      apiToken: token,
      publicUrl: "http://127.0.0.1:5173",
      seedFile: undefined,
      allowQuit: false,
      isProduction: false,
    };
    app = await buildApp({ config, storage: createStorage(config.databaseUrl), serveFrontend: false, logger: false });
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("protects CV data while keeping health public", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/cvs" })).statusCode).toBe(401);
  });

  it("creates, updates, exports, and deletes a CV", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const resume = { ...createEmptyResume(), name: "Agent Candidate", professionalTitle: "Design Lead" };
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/cvs",
      headers,
      payload: { title: "Design Lead CV", resume },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<CvDocument>();
    expect(created.revision).toBe(1);

    const updatedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/cvs/${created.id}`,
      headers,
      payload: { title: "Staff Design Lead CV", expectedRevision: 1 },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json<CvDocument>().revision).toBe(2);

    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/v1/cvs/${created.id}`,
      headers,
      payload: { title: "Stale update", expectedRevision: 1 },
    });
    expect(conflict.statusCode).toBe(409);

    const markdown = await app.inject({ method: "GET", url: `/api/v1/cvs/${created.id}/markdown`, headers });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain("# Agent Candidate");

    const pdf = await app.inject({ method: "GET", url: `/api/v1/cvs/${created.id}/pdf`, headers });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");

    expect((await app.inject({ method: "DELETE", url: `/api/v1/cvs/${created.id}`, headers })).statusCode).toBe(204);
  });

  it("creates an HttpOnly browser session", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/session", payload: { token } });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((value) => value.name === "cv_builder_session");
    expect(cookie?.httpOnly).toBe(true);
    const list = await app.inject({ method: "GET", url: "/api/v1/cvs", cookies: { cv_builder_session: cookie!.value } });
    expect(list.statusCode).toBe(200);
  });

  it("serves the CV tools over authenticated Streamable HTTP MCP", async () => {
    const client = new Client({ name: "cv-builder-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "list_cvs", "get_cv", "create_cv", "update_cv", "delete_cv", "export_cv",
    ]));
    const listed = await client.callTool({ name: "list_cvs", arguments: {} });
    expect(listed.isError).not.toBe(true);
    await client.close();
  });
});
