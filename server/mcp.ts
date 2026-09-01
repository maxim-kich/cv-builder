import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEmptyResume } from "../src/cvStore";
import { outputFilename, parseResumeMarkdown, resumeToMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";
import { resumeDataSchema } from "./schemas";
import type { CvStorage } from "./storage";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function notFound(id: string) {
  return { isError: true, content: [{ type: "text" as const, text: `CV ${id} was not found.` }] };
}

export function createMcpServer(storage: CvStorage, publicUrl: string): McpServer {
  const server = new McpServer({ name: "cv-builder", version: "1.0.0" }, {
    instructions: "Use these tools to create, edit, inspect, and export persistent CVs. Read a CV before updating it and pass expectedRevision when coordinating with other agents.",
  });

  server.registerTool("list_cvs", {
    title: "List CVs",
    description: "List saved CVs with their IDs, names, timestamps, and revisions.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const cvs = await storage.list();
    return json(cvs.map(({ resume, ...metadata }) => ({ ...metadata, candidate: resume.name, role: resume.professionalTitle })));
  });

  server.registerTool("get_cv", {
    title: "Get CV",
    description: "Get all structured fields and generated Markdown for one CV.",
    inputSchema: { id: z.string().min(1).describe("CV ID from list_cvs") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const cv = await storage.get(id);
    return cv ? json({ ...cv, markdown: resumeToMarkdown(cv.resume) }) : notFound(id);
  });

  server.registerTool("create_cv", {
    title: "Create CV",
    description: "Create and name a persistent CV. Supply CV Builder Markdown or a structured ResumeData object; omit both for a blank CV.",
    inputSchema: {
      title: z.string().min(1).max(200),
      markdown: z.string().max(500_000).optional(),
      resume: z.record(z.string(), z.unknown()).optional(),
      hideLanguageDots: z.boolean().default(false),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title, markdown, resume, hideLanguageDots }) => {
    if (markdown && resume) return { isError: true, content: [{ type: "text", text: "Provide either markdown or resume, not both." }] };
    const parsedResume = markdown
      ? parseResumeMarkdown(markdown)
      : resume
        ? resumeDataSchema.parse(resume)
        : createEmptyResume();
    return json(await storage.create({ title, resume: parsedResume, hideLanguageDots }));
  });

  server.registerTool("update_cv", {
    title: "Update CV",
    description: "Update a CV name, structured fields, Markdown content, or language-dot display. Pass expectedRevision to avoid overwriting another agent's edit.",
    inputSchema: {
      id: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      markdown: z.string().max(500_000).optional(),
      resume: z.record(z.string(), z.unknown()).optional(),
      hideLanguageDots: z.boolean().optional(),
      expectedRevision: z.number().int().positive().optional(),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ id, title, markdown, resume, hideLanguageDots, expectedRevision }) => {
    if (markdown && resume) return { isError: true, content: [{ type: "text", text: "Provide either markdown or resume, not both." }] };
    const result = await storage.update(id, {
      title,
      resume: markdown ? parseResumeMarkdown(markdown) : resume ? resumeDataSchema.parse(resume) : undefined,
      hideLanguageDots,
      expectedRevision,
    });
    if (result.status === "not_found") return notFound(id);
    if (result.status === "conflict") return { isError: true, content: [{ type: "text", text: `Revision conflict. The current CV is:\n${JSON.stringify(result.cv, null, 2)}` }] };
    return json(result.cv);
  });

  server.registerTool("delete_cv", {
    title: "Delete CV",
    description: "Permanently delete one CV.",
    inputSchema: { id: z.string().min(1) },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => json({ deleted: await storage.delete(id), id }));

  server.registerTool("export_cv", {
    title: "Export CV",
    description: "Render a CV and return either a PDF file resource or Markdown text.",
    inputSchema: {
      id: z.string().min(1),
      format: z.enum(["pdf", "markdown"]).default("pdf"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, format }) => {
    const cv = await storage.get(id);
    if (!cv) return notFound(id);
    const filename = format === "pdf" ? outputFilename(cv.resume) : `${cv.title.replace(/[^a-z0-9_-]+/gi, "-")}.md`;
    const downloadUrl = `${publicUrl}/api/v1/cvs/${encodeURIComponent(id)}/${format}`;
    if (format === "markdown") {
      return { content: [{ type: "text", text: resumeToMarkdown(cv.resume) }, { type: "resource_link", uri: downloadUrl, name: filename, mimeType: "text/markdown" }] };
    }
    const pdf = await renderResumeToBuffer(cv.resume, { showLanguageDots: !cv.hideLanguageDots });
    return {
      content: [
        { type: "text", text: `Rendered ${filename}. Authenticated download URL: ${downloadUrl}` },
        { type: "resource", resource: { uri: `cv-builder://cvs/${id}/${filename}`, mimeType: "application/pdf", blob: pdf.toString("base64") } },
      ],
    };
  });

  return server;
}
