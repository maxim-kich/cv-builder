// Run after npm run build. Uses a fresh local SQLite DB, never inherited DB/OAuth config.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { starterSource } from "../server/template/guide";
const directory = await mkdtemp(join(tmpdir(), "cv-built-smoke-"));
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const token = crypto.randomUUID();
const child = spawn(process.execPath, ["dist-server/index.js"], {
  env: { PATH: process.env.PATH, NODE_ENV: "production", CV_BUILDER_PUBLIC_URL: "https://template-smoke.invalid", HOST: "127.0.0.1", PORT: String(port), DATABASE_URL: `sqlite:${join(directory, "test.sqlite")}`, CV_BUILDER_API_TOKEN: token },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-4000); });
child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-4000); });
const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${origin}/api/v1/health`)).ok; } catch { /* Startup only */ }
    if (ready || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, `Built server did not start: ${logs}`);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const uploaded = await fetch(`${origin}/api/v1/templates`, { method: "POST", headers, body: JSON.stringify({ title: "Built worker template", source: starterSource, copyFontsFrom: "builtin:classic" }) });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const { template } = await uploaded.json();
  const created = await fetch(`${origin}/api/v1/cvs`, { method: "POST", headers, body: JSON.stringify({ title: "Built smoke", templateId: template.id }) });
  assert.equal(created.status, 201);
  const cv = await created.json();
  const exported = await fetch(`${origin}/api/v1/cvs/${cv.id}/pdf`, { headers });
  assert.equal(exported.status, 200, await exported.clone().text());
  assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,4).toString(), "%PDF");
  console.log("Built server + worker: template upload, bundled-font reuse, CV apply and PDF export passed.");
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await closed;
  clearTimeout(timer);
  await rm(directory, { recursive: true, force: true });
}
