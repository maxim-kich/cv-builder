import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "./build-pdf";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : await buildPdf();
const renderDirectory = path.join(PROJECT_ROOT, "tmp/pdfs/generated");
await rm(renderDirectory, { recursive: true, force: true });
await mkdir(renderDirectory, { recursive: true });
await run("pdftoppm", ["-png", "-r", "144", pdfPath, path.join(renderDirectory, "page")]);
console.log(`Rendered pages to ${path.relative(PROJECT_ROOT, renderDirectory)}`);
