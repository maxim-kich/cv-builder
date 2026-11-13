import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../server/app";
import { createStorage } from "../server/storage";
import { createEmptyResume } from "../src/cvStore";
import { starterSource } from "../server/template/guide";
import { inspectPdf } from "../scripts/pdf-inspection";
it("serves the final custom draft after two previous HTTP previews are aborted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cv-preview-abort-"));
  const storage = createStorage(`sqlite:${join(directory, "test.sqlite")}`);
  const app = await buildApp({ config: { databaseUrl: `sqlite:${join(directory, "test.sqlite")}`, host: "127.0.0.1", port: 0, publicUrl: "http://localhost", allowQuit: false, isProduction: false }, storage, serveFrontend: false, logger: false });
  try {
    const template = await storage.createTemplate("deployment-owner", { title: "Custom", source: starterSource, fonts: [] });
    const cv = await storage.create({ title: "Test", resume: createEmptyResume(), hideLanguageDots: false, template });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const controllers = [new AbortController(), new AbortController()];
    const request = (name: string, signal?: AbortSignal) => fetch(`${origin}/api/v1/cvs/${cv.id}/preview`, { method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify({ resume: { ...createEmptyResume(), name }, hideLanguageDots: false }) });
    const old = controllers.map((controller, i) => request(`Obsolete ${i}`, controller.signal).catch(() => undefined));
    await new Promise(resolve => setTimeout(resolve, 150));
    controllers.forEach(c => c.abort());
    const latest = await request("Final Candidate");
    expect(latest.status, await latest.clone().text()).toBe(200);
    const inspected = await inspectPdf(new Uint8Array(await latest.arrayBuffer()));
    expect(inspected.text).toContain("Final Candidate");
    expect(inspected.text).not.toContain("Obsolete");
    await Promise.all(old);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
