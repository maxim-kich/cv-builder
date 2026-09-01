import { describe, expect, it } from "vitest";
import { createCvDocument, createEmptyResume } from "../src/cvStore";

describe("CV document helpers", () => {
  it("creates a blank Untitled CV", () => {
    const cv = createCvDocument();
    expect(cv.title).toBe("Untitled");
    expect(cv.resume).toEqual(createEmptyResume());
  });

  it("creates timestamped revision metadata", () => {
    const cv = createCvDocument("Portfolio CV", createEmptyResume(), new Date("2026-09-01T12:00:00Z"));
    expect(cv.createdAt).toBe("2026-09-01T12:00:00.000Z");
    expect(cv.updatedAt).toBe(cv.createdAt);
    expect(cv.revision).toBe(1);
  });
});
