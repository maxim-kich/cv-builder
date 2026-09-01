import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createStorage } from "./storage";

const config = loadConfig();
const storage = createStorage(config.databaseUrl);
const app = await buildApp({ config, storage });

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({
    url: config.publicUrl,
    api: `${config.publicUrl}/api/v1`,
    mcp: `${config.publicUrl}/mcp`,
    storage: storage.kind,
    authentication: {
      oauth2: Boolean(config.oauth),
      staticBearer: Boolean(config.apiToken),
    },
  }, "CV Builder is ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().finally(() => process.exit(0)));
}
