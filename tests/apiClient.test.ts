import { afterEach, describe, expect, it, vi } from "vitest";
import { createCv, deleteCv } from "../src/apiClient";

describe("API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not declare JSON content for a bodyless delete request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteCv("empty-cv");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("declares JSON content when sending a JSON body", async () => {
    const responseBody = {
      id: "new-cv",
      title: "Untitled",
      resume: {},
      hideLanguageDots: false,
      revision: 1,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal("fetch", fetchMock);

    await createCv({ title: "Untitled" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});
