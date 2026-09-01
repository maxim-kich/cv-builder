import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const appId = args.get("--app-id");
const baseUrl = args.get("--base-url");
const owner = args.get("--owner") ?? "CV Builder owner";
if (!appId?.match(/^plugin_asdk_app[A-Za-z0-9_-]+$/)) {
  throw new Error("--app-id must be the plugin_asdk_app... ID shown by ChatGPT");
}
if (!baseUrl?.startsWith("https://") || new URL(baseUrl).pathname !== "/") {
  throw new Error("--base-url must be an HTTPS origin without a path");
}

const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
const manifestPath = resolve(root, ".codex-plugin/plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.apps = "./.app.json";
manifest.author = { name: `${owner}'s CV Builder`, url: normalizedBaseUrl };
manifest.homepage = `${normalizedBaseUrl}/docs/chatgpt-plugin`;
manifest.interface.displayName = `${owner}'s CV Builder`;
manifest.interface.developerName = `${owner}'s CV Builder`;
manifest.interface.websiteURL = normalizedBaseUrl;
manifest.interface.privacyPolicyURL = `${normalizedBaseUrl}/privacy`;
manifest.interface.termsOfServiceURL = `${normalizedBaseUrl}/terms`;

await writeFile(resolve(root, ".app.json"), `${JSON.stringify({
  apps: { cv_builder: { id: appId, category: "Productivity" } },
}, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Configured ${manifest.interface.displayName} for ${normalizedBaseUrl}`);
