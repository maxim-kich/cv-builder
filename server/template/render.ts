import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CvTemplate } from "../../src/templates";
import type { ResumeData } from "../../src/types";
import type { ParsingReport } from "./ats";
import { acquireRenderSlot, cancelled } from "./slots";
export class TemplateError extends Error {
  constructor(message: string, public readonly report?: ParsingReport) { super(message); }
}
export async function renderTemplate(template: CvTemplate, resume: ResumeData, showLanguageDots = true, signal?: AbortSignal): Promise<{ pdf: Buffer; report: ParsingReport }> {
  const release = await acquireRenderSlot(signal);
  try {
    if (signal?.aborted) throw cancelled();
    const development = import.meta.url.endsWith(".ts");
    const entry = fileURLToPath(new URL(development ? "./worker.ts" : "./template-worker.js", import.meta.url));
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=256", ...(development ? ["--import", "tsx"] : []), entry], {
        env: { PATH: process.env.PATH, NODE_ENV: "production" }, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let failure: Error | undefined;
      const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
      const abort = () => stop(cancelled());
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => stop(new TemplateError("Template rendering exceeded 20 seconds")), 20_000);
      if (signal?.aborted) abort();
      child.stdout.on("data", data => {
        output += data;
        if (output.length > 15_000_000) stop(new TemplateError("PDF exceeds output limit"));
      });
      child.stderr.resume();
      child.on("error", () => { failure ??= new TemplateError("Unable to start or stop template renderer"); });
      child.stdin.on("error", () => {});
      child.on("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure) { reject(failure); return; }
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
  } finally { release(); }
}
