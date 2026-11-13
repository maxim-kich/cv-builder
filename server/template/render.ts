import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CvTemplate } from "../../src/templates";
import type { ResumeData } from "../../src/types";
import type { ParsingReport } from "./ats";
let active = 0;
export class TemplateError extends Error {
  constructor(message: string, public readonly report?: ParsingReport) { super(message); }
}
export async function renderTemplate(template: CvTemplate, resume: ResumeData, showLanguageDots = true): Promise<{ pdf: Buffer; report: ParsingReport }> {
  if (active >= 2) throw new TemplateError("Template renderer busy; retry shortly");
  active++;
  try {
    const development = import.meta.url.endsWith(".ts");
    const entry = fileURLToPath(new URL(development ? "./worker.ts" : "./template-worker.js", import.meta.url));
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=256", ...(development ? ["--import", "tsx"] : []), entry], {
        env: { PATH: process.env.PATH, NODE_ENV: "production" }, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new TemplateError("Template rendering exceeded 20 seconds")); }, 20_000);
      child.stdout.on("data", data => {
        output += data;
        if (output.length > 15_000_000) child.kill("SIGKILL");
      });
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); reject(new TemplateError("Unable to start template renderer")); });
      child.stdin.on("error", () => {});
      child.on("close", () => {
        clearTimeout(timer);
        const marker = output.lastIndexOf("\nCV_TEMPLATE_RESULT:");
        if (marker < 0 || output.length > 15_000_000) reject(new TemplateError("Template renderer failed or exceeded resource limits"));
        else resolve(output.slice(marker + "\nCV_TEMPLATE_RESULT:".length));
      });
      child.stdin.end(JSON.stringify({ template, resume, showLanguageDots }));
    });
    let parsed: { pdf?: string; report?: ParsingReport; error?: string };
    try { parsed = JSON.parse(result); } catch { throw new TemplateError("Invalid template renderer result"); }
    if (!parsed.pdf || !parsed.report) throw new TemplateError(parsed.error ?? "Rendering failed");
    if (parsed.report.status !== "passed") throw new TemplateError("PDF parsing checks failed", parsed.report);
    return { pdf: Buffer.from(parsed.pdf, "base64"), report: parsed.report };
  } finally { active--; }
}
