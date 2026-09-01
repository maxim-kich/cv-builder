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
      .toThrow("CV_BUILDER_API_TOKEN is required in production");
    expect(() => loadConfig({ NODE_ENV: "production", CV_BUILDER_API_TOKEN: "short" }))
      .toThrow("CV_BUILDER_API_TOKEN must contain at least 6 characters");
    expect(loadConfig({ NODE_ENV: "production", CV_BUILDER_API_TOKEN: "sixsix" }).apiToken)
      .toBe("sixsix");
  });
});
