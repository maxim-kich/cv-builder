import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  apiToken?: string;
  publicUrl: string;
  seedFile?: string;
  allowQuit: boolean;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? env.CV_BUILDER_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const isProduction = env.NODE_ENV === "production";
  const host = env.HOST ?? env.CV_BUILDER_HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1");
  const databaseUrl = env.DATABASE_URL?.trim() || `sqlite:${resolve("data/cv-builder.sqlite")}`;
  const publicUrl = (env.CV_BUILDER_PUBLIC_URL ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`).replace(/\/$/, "");
  const apiToken = env.CV_BUILDER_API_TOKEN?.trim() || undefined;
  const seedFile = env.CV_BUILDER_SEED_FILE?.trim();

  if (isProduction && !apiToken) {
    throw new Error("CV_BUILDER_API_TOKEN is required in production");
  }
  if (apiToken && apiToken.length < 32) {
    throw new Error("CV_BUILDER_API_TOKEN must contain at least 32 characters");
  }

  return {
    host,
    port,
    databaseUrl,
    apiToken,
    publicUrl,
    seedFile: seedFile && seedFile !== "none" ? resolve(seedFile) : undefined,
    allowQuit: env.CV_BUILDER_ALLOW_QUIT === "1" || (!isProduction && env.CV_BUILDER_ALLOW_QUIT !== "0"),
    isProduction,
  };
}
