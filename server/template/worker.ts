import { pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { evaluateTemplate } from "./guest";
import { buildTree, registerFonts } from "./tree";
import { checkPdf } from "./ats";
import type { CvTemplate } from "../../src/templates";
import type { ResumeData } from "../../src/types";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8_000_000) throw new Error("Render input exceeds limit");
  }
  const { template, resume, showLanguageDots } = JSON.parse(input) as { template: CvTemplate; resume: ResumeData; showLanguageDots: boolean };
  const tree = await evaluateTemplate(template.source, resume, showLanguageDots);
  registerFonts(template);
  const stream = await pdf(buildTree(tree, template) as ReactElement<import("@react-pdf/renderer").DocumentProps>).toBuffer();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > 10_000_000) throw new Error("PDF exceeds output limit");
    chunks.push(buffer);
  }
  const buffer = Buffer.concat(chunks);
  const report = await checkPdf(buffer, resume);
  // Dedicated protocol marker: renderer/PDF.js diagnostic logging cannot corrupt JSON.
  process.stdout.write("\nCV_TEMPLATE_RESULT:" + JSON.stringify({ pdf: buffer.toString("base64"), report }));
}
main().catch((error: unknown) => { process.stdout.write("\nCV_TEMPLATE_RESULT:" + JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 1500) : "Template validation failed" })); process.exitCode = 1; });
