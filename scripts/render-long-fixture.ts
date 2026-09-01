import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResumeMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";
import { withLongBullet } from "../tests/fixtures/long-bullet";
import { SOURCE_MARKDOWN } from "./build-pdf";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(PROJECT_ROOT, "tmp/pdfs/long-fixture");
const pdfPath = path.join(directory, "long-bullet.pdf");

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const markdown = withLongBullet(await readFile(SOURCE_MARKDOWN, "utf8"));
await writeFile(pdfPath, await renderResumeToBuffer(parseResumeMarkdown(markdown)));
await run("pdftoppm", ["-png", "-r", "144", pdfPath, path.join(directory, "page")]);
console.log(`Rendered long-bullet fixture to ${path.relative(PROJECT_ROOT, directory)}`);
