import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outputFilename, parseResumeMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_MARKDOWN = path.join(
  PROJECT_ROOT,
  "examples/sample-cv.md",
);

export async function buildPdf(
  sourcePath = SOURCE_MARKDOWN,
  outputDirectory = path.join(PROJECT_ROOT, "outputs"),
): Promise<string> {
  const markdown = await readFile(sourcePath, "utf8");
  const resume = parseResumeMarkdown(markdown);
  const outputPath = path.join(outputDirectory, outputFilename(resume));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, await renderResumeToBuffer(resume));
  return outputPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = await buildPdf(process.argv[2]);
  console.log(`Generated ${path.relative(PROJECT_ROOT, output)}`);
}
