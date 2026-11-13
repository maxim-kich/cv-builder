import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildApp } from "../server/app";
import { createStorage } from "../server/storage";
import { ALL_CV_SCOPES } from "../server/auth";
import { starterSource } from "../server/template/guide";
import { evaluateTemplate } from "../server/template/guest";
import { buildTree } from "../server/template/tree";
import { renderTemplate } from "../server/template/render";
import { readDefaultTemplate } from "../server/template/catalog";
import { createEmptyResume } from "../src/cvStore";

it("isolates guest code, validates output and blocks resource access and runaway code", async () => {
  const resume = createEmptyResume();
  for (const source of [
    'import fs from "node:fs"; export default () => fs.readFileSync("/etc/passwd")',
    'export default () => process.env',
    'export default () => require("node:fs").readFileSync("/etc/passwd")',
    'export default () => fetch("https://example.com")',
    'export default () => {while(true){}}',
    'export default () => { const a=[]; while(true) a.push("x".repeat(10000)); }',
    'export default () => import("node:fs")',
  ]) await expect(evaluateTemplate(source, resume, true)).rejects.toThrow();
  const probe = await evaluateTemplate('import {Document,Page,Text} from "@react-pdf/renderer"; export default () => <Document><Page><Text>{typeof process + "/" + typeof fetch}</Text></Page></Document>', resume, true);
  expect(JSON.stringify(probe)).toContain("undefined/undefined");
  for (const source of [
    'export default () => <Document><Page><Image src="file:///etc/passwd" /></Page></Document>',
    'export default () => <Document><Page style={{fontFamily:"/etc/passwd"}} /></Document>',
    'export default () => <Document><Page><Link src="file:///etc/passwd">x</Link></Page></Document>',
    'export default () => <Document><Page><Text style={{backgroundColor:"url(http://127.0.0.1)"}}>x</Text></Page></Document>',
    'export default () => <Document><Page><View src="http://127.0.0.1" /></Page></Document>',
  ]) {
    // Components must be imported; unbound JSX component names also fail safely.
    const code = 'import {Document,Page,Text,View,Link} from "@react-pdf/renderer";\n' + source;
    await expect((async () => buildTree(await evaluateTemplate(code, resume, true), { fonts: [] }))()).rejects.toThrow();
  }
}, 15000);

it("blocks PDF exports that omit CV text", async () => {
  const source = 'import {Document,Page,Text} from "@react-pdf/renderer"; export default () => <Document><Page><Text>Wrong content</Text></Page></Document>';
  await expect(renderTemplate({ id: "x", title: "x", source, fonts: [], revision: 1, createdAt: "", updatedAt: "" }, { ...createEmptyResume(), name: "Required Candidate" })).rejects.toMatchObject({ report: { status: "failed", missingText: ["Required Candidate"] } });
}, 30000);

it("supports complete template lifecycle through REST and MCP while preserving snapshots and default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cv-react-templates-"));
  const databaseUrl = `sqlite:${join(directory, "test.sqlite")}`;
  const config = { host: "127.0.0.1", port: 0, databaseUrl, apiToken: "test-local-token-long-enough", publicUrl: "http://localhost", allowQuit: false, isProduction: false };
  const verifier = { async verify(token: string) { return { method: "oauth" as const, subject: token, authInfo: { token, clientId: "test", scopes: token === "read" ? ["cvs:read"] : [...ALL_CV_SCOPES], extra: { authMethod: "oauth", sub: token } } }; } };
  let app = await buildApp({ config, storage: createStorage(databaseUrl), oauthVerifier: verifier, serveFrontend: false, logger: false });
  const headers = { authorization: "Bearer alice" };
  try {
    expect((await app.inject({ url: "/api/v1/templates" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/templates", headers: { authorization: "Bearer read" }, payload: { title: "x", source: starterSource } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/templates", headers, payload: { title: "bad", source: "export default () => process.env" } })).statusCode).toBe(422);
    expect((await app.inject({ url: "/api/v1/templates", headers })).json().items).toHaveLength(1);
    const uploaded = await app.inject({ method: "POST", url: "/api/v1/templates", headers, payload: { title: "Custom", source: starterSource } });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const template = uploaded.json().template;
    expect(uploaded.json().checks.long.status).toBe("passed");
    expect((await app.inject({ url: `/api/v1/templates/${template.id}`, headers: { authorization: "Bearer bob" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/v1/templates", headers: { authorization: "Bearer bob" }, payload: { title: "Forbidden font copy", source: starterSource, copyFontsFrom: template.id } })).statusCode).toBe(422);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/templates/${template.id}`, headers: { authorization: "Bearer bob" }, payload: { expectedRevision: 1 } })).statusCode).toBe(404);
    const cv = (await app.inject({ method: "POST", url: "/api/v1/cvs", headers, payload: { title: "Styled", resume: { ...createEmptyResume(), name: "Saved Candidate" }, templateId: template.id } })).json();
    expect(cv.template.id).toBe(template.id);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/cvs/${cv.id}`, headers, payload: { templateId: "builtin:classic" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/templates/${template.id}`, headers, payload: { expectedRevision: 2 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/templates/${template.id}`, headers, payload: { expectedRevision: 1 } })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/api/v1/templates/builtin:classic", headers, payload: { expectedRevision: 1 } })).statusCode).toBe(404);
    await app.close();
    app = await buildApp({ config, storage: createStorage(databaseUrl), oauthVerifier: verifier, serveFrontend: false, logger: false });
    expect((await app.inject({ url: `/api/v1/cvs/${cv.id}`, headers })).json().template.source).toBe(starterSource);
    expect((await app.inject({ url: `/api/v1/cvs/${cv.id}/pdf`, headers })).body.slice(0, 4)).toBe("%PDF");
    expect((await app.inject({ method: "POST", url: `/api/v1/cvs/${cv.id}/preview`, headers, payload: { resume: { ...createEmptyResume(), name: "Unsaved draft" }, hideLanguageDots: true } })).body.slice(0, 4)).toBe("%PDF");
    expect((await app.inject({ url: `/api/v1/cvs/${cv.id}`, headers })).json().resume.name).toBe("Saved Candidate");
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "template-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers } }));
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(expect.arrayContaining(["get_template_guide", "list_templates", "get_template", "upload_template", "delete_template"]));
      const text = (result: Awaited<ReturnType<typeof client.callTool>>) => (result.content as { text: string }[])[0].text;
      expect(text(await client.callTool({ name: "get_template_guide", arguments: {} }))).toContain("Complete starter");
      expect((await client.readResource({ uri: "cv-builder://templates/guide" })).contents[0]).toMatchObject({ mimeType: "text/markdown" });
      const classic = JSON.parse(text(await client.callTool({ name: "get_template", arguments: { id: "builtin:classic" } })));
      expect(classic.fonts).toHaveLength(4);
      expect(classic.fonts[0].data).toBeUndefined();
      const cloned = await client.callTool({ name: "upload_template", arguments: { title: "Classic copy", source: classic.source, copyFontsFrom: classic.copyFontsFrom } });
      expect(cloned.isError, text(cloned)).not.toBe(true);
      expect(text(cloned).length).toBeLessThan(30000);
      const result = await client.callTool({ name: "upload_template", arguments: { title: "MCP", source: starterSource } });
      expect(result.isError, text(result)).not.toBe(true);
      const saved = JSON.parse(text(result)).template;
      expect(JSON.parse(text(await client.callTool({ name: "get_template", arguments: { id: saved.id } }))).source).toBe(starterSource);
      expect((await client.callTool({ name: "update_cv", arguments: { id: cv.id, templateId: saved.id, expectedRevision: 99 } })).isError).toBe(true);
      expect((await client.callTool({ name: "update_cv", arguments: { id: cv.id, templateId: saved.id, expectedRevision: 1 } })).isError).not.toBe(true);
      expect((await app.inject({ url: `/api/v1/cvs/${cv.id}`, headers })).json().template.id).toBe(saved.id);
      expect((await client.callTool({ name: "delete_template", arguments: { id: saved.id, expectedRevision: 1 } })).isError).not.toBe(true);
      expect((await client.callTool({ name: "export_cv", arguments: { id: cv.id, format: "pdf" } })).isError).not.toBe(true);
      const reset = await app.inject({ method: "PATCH", url: `/api/v1/cvs/${cv.id}`, headers, payload: { templateId: "builtin:classic", expectedRevision: 2 } });
      expect(reset.statusCode).toBe(200);
      expect(reset.json().template).toBeUndefined();
      expect((await app.inject({ url: `/api/v1/cvs/${cv.id}/pdf`, headers })).body.slice(0, 4)).toBe("%PDF");
    } finally { await client.close(); }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 90000);

it("can clone the immutable default with bundled font assets into the isolated renderer", async () => {
  const template = await readDefaultTemplate();
  const result = await renderTemplate(template, { ...createEmptyResume(), name: "Default Clone", professionalTitle: "Designer" });
  expect(result.report.status).toBe("passed");
  expect(result.pdf.subarray(0,4).toString()).toBe("%PDF");
}, 30000);

it("migrates legacy SQLite without changing CV content or revision", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = await mkdtemp(join(tmpdir(), "cv-legacy-"));
  const path = join(directory, "legacy.sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE cvs (id TEXT PRIMARY KEY, title TEXT NOT NULL, resume TEXT NOT NULL, hide_language_dots INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL)");
  database.prepare("INSERT INTO cvs VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy", "Original", JSON.stringify(createEmptyResume()), 1, "2026-01-01", "2026-01-01", 9);
  database.close();
  const storage = createStorage(`sqlite:${path}`);
  try {
    await storage.init();
    expect(await storage.get("legacy")).toMatchObject({ title: "Original", resume: createEmptyResume(), revision: 9, hideLanguageDots: true });
    expect((await storage.get("legacy"))?.template).toBeUndefined();
  } finally { await storage.close(); await rm(directory, { recursive: true, force: true }); }
});
