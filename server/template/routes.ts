import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { CvStorage } from "../storage";
import { defaultMetadata, findTemplate, uploadTemplate } from "./catalog";
import { deleteTemplateSchema, uploadTemplateSchema } from "./schema";
import { authoringGuide } from "./guide";
import { resumeDataSchema } from "../schemas";
import { renderCv } from "./export";
import { z } from "zod";
export function templateRoutes(app: FastifyInstance, storage: CvStorage, authenticate: (scopes: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>, owner: (request: FastifyRequest) => string) {
  app.get("/api/v1/templates/guide", { preHandler: authenticate(["cvs:read"]) }, async () => ({ guide: authoringGuide }));
  app.get("/api/v1/templates", { preHandler: authenticate(["cvs:read"]) }, async request => ({ items: [defaultMetadata, ...(await storage.listTemplates(owner(request))).map(({ source, fonts, ...metadata }) => ({ ...metadata, builtIn: false, fontFamilies: [...new Set(fonts.map(f => f.family))] }))] }));
  app.get<{ Params: { id: string } }>("/api/v1/templates/:id", { preHandler: authenticate(["cvs:read"]) }, async (request, reply) =>
    await findTemplate(storage, owner(request), request.params.id) ?? reply.code(404).send({ error: "not_found" }));
  app.post("/api/v1/templates", { bodyLimit: 8_000_000, preHandler: authenticate(["cvs:write"]) }, async (request, reply) => {
    const parsed = uploadTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return reply.code(201).send(await uploadTemplate(storage, owner(request), parsed.data));
  });
  app.delete<{ Params: { id: string } }>("/api/v1/templates/:id", { preHandler: authenticate(["cvs:delete"]) }, async (request, reply) => {
    const parsed = deleteTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await storage.getTemplate(owner(request), request.params.id)) return reply.code(404).send({ error: "not_found" });
    if (!await storage.deleteTemplate(owner(request), request.params.id, parsed.data.expectedRevision)) return reply.code(409).send({ error: "revision_conflict" });
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/cvs/:id/preview", { bodyLimit: 1_000_000, preHandler: authenticate(["cvs:export"]) }, async (request, reply) => {
    const parsed = z.object({ resume: resumeDataSchema, hideLanguageDots: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) controller.abort(); };
    reply.raw.on("close", disconnected);
    request.raw.on("aborted", disconnected);
    try {
      const cv = await storage.get(request.params.id);
      if (!cv) return reply.code(404).send({ error: "not_found" });
      const pdf = await renderCv({ ...cv, ...parsed.data }, controller.signal);
      return reply.type("application/pdf").header("Cache-Control", "no-store").send(pdf);
    } finally {
      reply.raw.off("close", disconnected);
      request.raw.off("aborted", disconnected);
    }
  });
}
