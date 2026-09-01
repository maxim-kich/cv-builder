import { createHash, timingSafeEqual } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createEmptyResume } from "../src/cvStore";
import { outputFilename, parseResumeMarkdown, resumeToMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";
import type { ResumeData } from "../src/types";
import type { AppConfig } from "./config";
import { createMcpServer } from "./mcp";
import { createOpenApiDocument } from "./openapi";
import { createCvSchema, updateCvSchema } from "./schemas";
import type { CvStorage } from "./storage";

interface BuildAppOptions {
  config: AppConfig;
  storage: CvStorage;
  serveFrontend?: boolean;
  logger?: boolean;
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function tokensEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return timingSafeEqual(tokenDigest(left), tokenDigest(right));
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}

function sessionValue(token: string): string {
  return tokenDigest(`cv-builder-session:${token}`).toString("base64url");
}

async function loadSeed(seedFile: string | undefined): Promise<ResumeData> {
  if (!seedFile) return createEmptyResume();
  try {
    return parseResumeMarkdown(await readFile(seedFile, "utf8"));
  } catch {
    return createEmptyResume();
  }
}

export async function buildApp({ config, storage, serveFrontend = true, logger = true }: BuildAppOptions) {
  const app = Fastify({ logger });
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

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.apiToken) return;
    const validBearer = tokensEqual(bearerToken(request), config.apiToken);
    const validSession = tokensEqual(request.cookies.cv_builder_session, sessionValue(config.apiToken));
    if (!validBearer && !validSession) {
      return reply.code(401).send({ error: "unauthorized", message: "A valid bearer token or browser session is required." });
    }
  };

  app.get("/api/v1/health", async () => ({
    ok: true,
    storage: storage.kind,
    authRequired: Boolean(config.apiToken),
    canQuit: config.allowQuit,
    apiVersion: "v1",
    mcpEndpoint: `${config.publicUrl}/mcp`,
  }));

  app.get("/api/v1/openapi.json", async () => createOpenApiDocument(config.publicUrl));

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

  app.get("/api/v1/cvs", { preHandler: authenticate }, async () => ({ items: await storage.list() }));

  app.post("/api/v1/cvs", { preHandler: authenticate }, async (request, reply) => {
    const parsed = createCvSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const resume = parsed.data.markdown ? parseResumeMarkdown(parsed.data.markdown) : parsed.data.resume ?? createEmptyResume();
    const cv = await storage.create({ title: parsed.data.title, resume, hideLanguageDots: parsed.data.hideLanguageDots });
    return reply.code(201).send(cv);
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    return cv ?? reply.code(404).send({ error: "not_found" });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate }, async (request, reply) => {
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

  app.delete<{ Params: { id: string } }>("/api/v1/cvs/:id", { preHandler: authenticate }, async (request, reply) => {
    if (!await storage.delete(request.params.id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id/markdown", { preHandler: authenticate }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    if (!cv) return reply.code(404).send({ error: "not_found" });
    const filename = `${cv.title.replace(/[^a-z0-9_-]+/gi, "-") || "cv"}.md`;
    return reply.type("text/markdown; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send(resumeToMarkdown(cv.resume));
  });

  app.get<{ Params: { id: string } }>("/api/v1/cvs/:id/pdf", { preHandler: authenticate }, async (request, reply) => {
    const cv = await storage.get(request.params.id);
    if (!cv) return reply.code(404).send({ error: "not_found" });
    const pdf = await renderResumeToBuffer(cv.resume, { showLanguageDots: !cv.hideLanguageDots });
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="${outputFilename(cv.resume)}"`).send(pdf);
  });

  app.all("/mcp", { preHandler: authenticate }, async (request, reply) => {
    if (request.method !== "POST") {
      return reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    }
    const server = createMcpServer(storage, config.publicUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
