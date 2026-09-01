import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

function quitServerPlugin(): Plugin {
  return {
    name: "cv-builder-quit-server",
    configureServer(server) {
      server.middlewares.use("/api/quit", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: true, quitting: true }));
        setTimeout(() => {
          void server.close().finally(() => process.exit(0));
        }, 50).unref();
      });
    },
  };
}

export default defineConfig({ plugins: [react(), quitServerPlugin()] });
