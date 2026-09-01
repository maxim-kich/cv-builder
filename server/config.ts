import { resolve } from "node:path";

const MIN_API_TOKEN_LENGTH = 6;

export interface OAuthIntrospectionConfig {
  url: string;
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
  allowedSubjects: Set<string>;
  algorithms: string[];
  maxTokenLifetimeSeconds: number;
  revokedTokenIds: Set<string>;
  revokedBefore?: number;
  introspection?: OAuthIntrospectionConfig;
}

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  apiToken?: string;
  oauth?: OAuthConfig;
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
  const oauthIssuer = env.CV_BUILDER_OAUTH_ISSUER?.trim();
  const oauthAudience = env.CV_BUILDER_OAUTH_AUDIENCE?.trim() || `${publicUrl}/mcp`;
  const oauthJwksUrl = env.CV_BUILDER_OAUTH_JWKS_URL?.trim();
  const allowedSubjects = new Set((env.CV_BUILDER_OAUTH_ALLOWED_SUBJECTS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  const oauthParts = [oauthIssuer, oauthJwksUrl, allowedSubjects.size > 0 ? "subjects" : undefined];
  const oauthConfigured = oauthParts.some(Boolean);
  if (oauthConfigured && !oauthParts.every(Boolean)) {
    throw new Error("OAuth requires CV_BUILDER_OAUTH_ISSUER, CV_BUILDER_OAUTH_JWKS_URL, and CV_BUILDER_OAUTH_ALLOWED_SUBJECTS");
  }
  const introspectionParts = [
    env.CV_BUILDER_OAUTH_INTROSPECTION_URL?.trim(),
    env.CV_BUILDER_OAUTH_INTROSPECTION_CLIENT_ID?.trim(),
    env.CV_BUILDER_OAUTH_INTROSPECTION_CLIENT_SECRET?.trim(),
  ];
  if (introspectionParts.some(Boolean) && !introspectionParts.every(Boolean)) {
    throw new Error("OAuth introspection requires its URL, client ID, and client secret together");
  }
  const revokedBeforeRaw = env.CV_BUILDER_OAUTH_REVOKED_BEFORE?.trim();
  const revokedBefore = revokedBeforeRaw ? Number(revokedBeforeRaw) : undefined;
  if (revokedBefore !== undefined && (!Number.isInteger(revokedBefore) || revokedBefore < 0)) {
    throw new Error("CV_BUILDER_OAUTH_REVOKED_BEFORE must be a non-negative Unix timestamp");
  }
  const maxTokenLifetimeSeconds = Number(env.CV_BUILDER_OAUTH_MAX_TOKEN_LIFETIME_SECONDS ?? 600);
  if (!Number.isInteger(maxTokenLifetimeSeconds) || maxTokenLifetimeSeconds < 60 || maxTokenLifetimeSeconds > 3_600) {
    throw new Error("CV_BUILDER_OAUTH_MAX_TOKEN_LIFETIME_SECONDS must be between 60 and 3600");
  }
  const oauth: OAuthConfig | undefined = oauthConfigured ? {
    issuer: oauthIssuer!,
    audience: oauthAudience,
    jwksUrl: oauthJwksUrl!,
    allowedSubjects,
    algorithms: (env.CV_BUILDER_OAUTH_ALGORITHMS ?? "RS256").split(",").map((value) => value.trim()).filter(Boolean),
    maxTokenLifetimeSeconds,
    revokedTokenIds: new Set((env.CV_BUILDER_OAUTH_REVOKED_TOKEN_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
    revokedBefore,
    introspection: introspectionParts.every(Boolean) ? {
      url: introspectionParts[0]!,
      clientId: introspectionParts[1]!,
      clientSecret: introspectionParts[2]!,
    } : undefined,
  } : undefined;

  if (oauth && oauth.audience !== `${publicUrl}/mcp`) {
    throw new Error("CV_BUILDER_OAUTH_AUDIENCE must exactly equal CV_BUILDER_PUBLIC_URL followed by /mcp");
  }

  if (isProduction && !apiToken && !oauth) {
    throw new Error("CV_BUILDER_API_TOKEN or OAuth configuration is required in production");
  }
  if (apiToken && apiToken.length < MIN_API_TOKEN_LENGTH) {
    throw new Error(`CV_BUILDER_API_TOKEN must contain at least ${MIN_API_TOKEN_LENGTH} characters`);
  }
  if (isProduction && oauth && oauth.allowedSubjects.size !== 1) {
    throw new Error("Production deployments must allow exactly one OAuth subject");
  }
  if (isProduction) {
    for (const [name, value] of [
      ["CV_BUILDER_PUBLIC_URL", publicUrl],
      ["CV_BUILDER_OAUTH_ISSUER", oauth?.issuer],
      ["CV_BUILDER_OAUTH_JWKS_URL", oauth?.jwksUrl],
      ["CV_BUILDER_OAUTH_INTROSPECTION_URL", oauth?.introspection?.url],
    ] as const) {
      if (value && !value.startsWith("https://")) throw new Error(`${name} must use HTTPS in production`);
    }
  }

  return {
    host,
    port,
    databaseUrl,
    apiToken,
    oauth,
    publicUrl,
    seedFile: seedFile && seedFile !== "none" ? resolve(seedFile) : undefined,
    allowQuit: env.CV_BUILDER_ALLOW_QUIT === "1" || (!isProduction && env.CV_BUILDER_ALLOW_QUIT !== "0"),
    isProduction,
  };
}
