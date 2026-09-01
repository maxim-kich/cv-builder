import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthConfig } from "./config";

export const CV_SCOPES = {
  read: "cvs:read",
  write: "cvs:write",
  export: "cvs:export",
  delete: "cvs:delete",
} as const;

export const ALL_CV_SCOPES = Object.values(CV_SCOPES);

export type AccessMethod = "development" | "static" | "session" | "oauth";

export interface AccessContext {
  authInfo: AuthInfo;
  method: AccessMethod;
  subject: string;
}

export class AccessTokenError extends Error {
  constructor(
    readonly code: "invalid_token" | "insufficient_scope",
    message: string,
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

export interface OAuthTokenVerifier {
  verify(token: string): Promise<AccessContext>;
}

interface OAuthVerifierOptions {
  getKey?: JWTVerifyGetKey;
  fetch?: typeof globalThis.fetch;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function tokensEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return timingSafeEqual(digest(left), digest(right));
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}

export function sessionValue(token: string): string {
  return digest(`cv-builder-session:${token}`).toString("base64url");
}

function tokenScopes(payload: JWTPayload): string[] {
  const scope = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...scope, ...permissions].filter(Boolean))];
}

function tokenClientId(payload: JWTPayload): string {
  if (typeof payload.client_id === "string") return payload.client_id;
  if (typeof payload.azp === "string") return payload.azp;
  return "oauth-client";
}

async function assertActiveByIntrospection(
  token: string,
  config: OAuthConfig,
  fetchImplementation: typeof globalThis.fetch,
): Promise<void> {
  if (!config.introspection) return;
  const credentials = Buffer.from(
    `${encodeURIComponent(config.introspection.clientId)}:${encodeURIComponent(config.introspection.clientSecret)}`,
  ).toString("base64");
  const response = await fetchImplementation(config.introspection.url, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new AccessTokenError("invalid_token", "Token revocation check failed.");
  const result = await response.json() as { active?: boolean };
  if (result.active !== true) throw new AccessTokenError("invalid_token", "The access token is inactive or revoked.");
}

export function createOAuthTokenVerifier(
  config: OAuthConfig,
  options: OAuthVerifierOptions = {},
): OAuthTokenVerifier {
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(config.jwksUrl));
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async verify(token: string): Promise<AccessContext> {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: config.algorithms,
          clockTolerance: 5,
          requiredClaims: ["sub", "iat", "exp", "jti"],
        });
        if (!payload.sub) throw new AccessTokenError("invalid_token", "The access token has no subject.");
        if (!config.allowedSubjects.has(payload.sub)) {
          throw new AccessTokenError("invalid_token", "This identity is not allowed to access this deployment.");
        }
        if (payload.exp! <= payload.iat! || payload.exp! - payload.iat! > config.maxTokenLifetimeSeconds) {
          throw new AccessTokenError("invalid_token", "The access token lifetime exceeds policy.");
        }
        if (payload.jti && config.revokedTokenIds.has(payload.jti)) {
          throw new AccessTokenError("invalid_token", "The access token has been revoked.");
        }
        if (config.revokedBefore !== undefined && (payload.iat === undefined || payload.iat <= config.revokedBefore)) {
          throw new AccessTokenError("invalid_token", "The access token predates the deployment revocation cutoff.");
        }
        await assertActiveByIntrospection(token, config, fetchImplementation);
        const scopes = tokenScopes(payload);
        return {
          method: "oauth",
          subject: payload.sub,
          authInfo: {
            token,
            clientId: tokenClientId(payload),
            scopes,
            expiresAt: payload.exp,
            resource: new URL(config.audience),
            extra: { sub: payload.sub, jti: payload.jti, authMethod: "oauth" },
          },
        };
      } catch (error) {
        if (error instanceof AccessTokenError) throw error;
        throw new AccessTokenError("invalid_token", "The access token is malformed, expired, or could not be verified.");
      }
    },
  };
}

export function localAccessContext(token = "development"): AccessContext {
  return {
    method: token === "development" ? "development" : "static",
    subject: token === "development" ? "local-development" : "static-agent",
    authInfo: {
      token,
      clientId: "cv-builder-local-agent",
      scopes: [...ALL_CV_SCOPES],
      extra: { authMethod: token === "development" ? "development" : "static" },
    },
  };
}

export function sessionAccessContext(token: string): AccessContext {
  return {
    ...localAccessContext(token),
    method: "session",
    subject: "browser-session",
    authInfo: {
      ...localAccessContext(token).authInfo,
      clientId: "cv-builder-browser",
      extra: { authMethod: "session" },
    },
  };
}

export function missingScopes(authInfo: AuthInfo, required: readonly string[]): string[] {
  return required.filter((scope) => !authInfo.scopes.includes(scope));
}

export function oauthChallenge(
  resourceMetadataUrl: string,
  code: "invalid_token" | "insufficient_scope",
  description: string,
  scopes: readonly string[] = [],
): string {
  const escaped = description.replace(/["\\\r\n]/g, " ");
  const scope = scopes.length > 0 ? `, scope="${scopes.join(" ")}"` : "";
  return `Bearer resource_metadata="${resourceMetadataUrl}", error="${code}", error_description="${escaped}"${scope}`;
}

export function oauthSecurityMetadata(scopes: readonly string[]) {
  return {
    securitySchemes: [{ type: "oauth2", scopes: [...scopes] }],
  };
}
