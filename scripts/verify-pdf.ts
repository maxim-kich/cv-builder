import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResumeMarkdown } from "../src/parser";
import { buildPdf, SOURCE_MARKDOWN } from "./build-pdf";
import { inspectPdf } from "./pdf-inspection";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resume = parseResumeMarkdown(await readFile(SOURCE_MARKDOWN, "utf8"));
const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : await buildPdf();
const result = await inspectPdf(await readFile(pdfPath));
const expectedUrls = [
  resume.contact.email.url,
  resume.contact.phone.url,
  ...resume.contact.links.map((link) => link.url),
];

const checks: Array<[string, boolean]> = [
  ["sample fixture spans exactly two pages", result.pages.length === 2],
  [
    "both pages are A4",
    result.pages.every(
      ({ width, height }) => Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1,
    ),
  ],
  ["all expected URL annotations exist", expectedUrls.every((url) => result.urls.includes(url))],
  ["name is first in extracted text", result.text.trim().startsWith(resume.name)],
  [
    "employment order is preserved",
    resume.employment.every(
      (entry, index, entries) =>
        index === 0 || result.text.indexOf(entries[index - 1].title) < result.text.indexOf(entry.title),
    ),
  ],
  ["no invisible text rendering modes", result.invisibleTextModes.length === 0],
  ["no white text operations", result.whiteTextOperations === 0],
  ["vector paths include language indicators", result.pathOperations >= resume.languages.length * 5],
];

for (const [label, passed] of checks) console.log(`${passed ? "✓" : "✗"} ${label}`);
const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) process.exitCode = 1;
else console.log(`Verified ${path.relative(PROJECT_ROOT, pdfPath)}`);
