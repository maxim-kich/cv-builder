import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";

describe("server configuration", () => {
  it("starts development with no seed file by default", () => {
    expect(loadConfig({ NODE_ENV: "development" }).seedFile).toBeUndefined();
  });

  it("resolves an explicitly configured seed file", () => {
    expect(loadConfig({ CV_BUILDER_SEED_FILE: "examples/sample-cv.md" }).seedFile)
      .toBe(path.resolve("examples/sample-cv.md"));
  });

  it("requires an access token with at least six characters in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }))
      .toThrow("CV_BUILDER_API_TOKEN or OAuth configuration is required in production");
    expect(() => loadConfig({ NODE_ENV: "production", CV_BUILDER_API_TOKEN: "short" }))
      .toThrow("CV_BUILDER_API_TOKEN must contain at least 6 characters");
    expect(loadConfig({
      NODE_ENV: "production",
      CV_BUILDER_API_TOKEN: "sixsix",
      CV_BUILDER_PUBLIC_URL: "https://cv.example.test",
    }).apiToken)
      .toBe("sixsix");
  });

  it("loads a complete HTTPS OAuth resource-server configuration", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      CV_BUILDER_PUBLIC_URL: "https://cv.example.test",
      CV_BUILDER_OAUTH_ISSUER: "https://tenant.example.test/",
      CV_BUILDER_OAUTH_JWKS_URL: "https://tenant.example.test/.well-known/jwks.json",
      CV_BUILDER_OAUTH_ALLOWED_SUBJECTS: "auth0|maxim",
    });
    expect(config.oauth?.audience).toBe("https://cv.example.test/mcp");
    expect(config.oauth?.allowedSubjects).toEqual(new Set(["auth0|maxim"]));
    expect(config.oauth?.algorithms).toEqual(["RS256"]);
    expect(config.oauth?.maxTokenLifetimeSeconds).toBe(600);
  });

  it("rejects partial, insecure, and invalid revocation configuration", () => {
    expect(() => loadConfig({ CV_BUILDER_OAUTH_ISSUER: "https://tenant.example.test/" }))
      .toThrow("OAuth requires");
    expect(() => loadConfig({
      NODE_ENV: "production",
      CV_BUILDER_PUBLIC_URL: "http://cv.example.test",
      CV_BUILDER_API_TOKEN: "sixsix",
    })).toThrow("CV_BUILDER_PUBLIC_URL must use HTTPS");
    expect(() => loadConfig({
      CV_BUILDER_API_TOKEN: "sixsix",
      CV_BUILDER_OAUTH_REVOKED_BEFORE: "yesterday",
    })).toThrow("CV_BUILDER_OAUTH_REVOKED_BEFORE");
    expect(() => loadConfig({
      CV_BUILDER_OAUTH_ISSUER: "https://tenant.example.test/",
      CV_BUILDER_OAUTH_JWKS_URL: "https://tenant.example.test/.well-known/jwks.json",
      CV_BUILDER_OAUTH_ALLOWED_SUBJECTS: "auth0|maxim",
      CV_BUILDER_OAUTH_AUDIENCE: "https://another.example.test/mcp",
    })).toThrow("must exactly equal");
  });
});
