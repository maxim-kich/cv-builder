// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createCvDocument, createEmptyResume } from "../src/cvStore";
import type { CvDocument } from "../src/cvStore";
const state = vi.hoisted(() => ({ documents: [] as CvDocument[], update: vi.fn() }));
vi.mock("@react-pdf/renderer", () => ({ usePDF: () => [{ url: "blob:default-renderer" }, state.update] }));
vi.mock("../src/pdf/ResumeDocument", () => ({ ResumeDocument: () => null }));
vi.mock("../src/PdfPreview", () => ({ PdfPreview: ({ url }: { url: string }) => <div data-testid="preview" data-url={url} /> }));
vi.mock("../src/apiClient", async importOriginal => ({
  ...await importOriginal<typeof import("../src/apiClient")>(),
  listCvs: async () => ({ items: state.documents }),
  getRuntimeInfo: async () => ({ canQuit: false }),
  updateCv: async (id: string, draft: unknown) => ({ ...state.documents.find(cv => cv.id === id), ...draft as object }),
}));
import App from "../src/App";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("editor preview and download use the same checked custom draft, never the default renderer", async () => {
  const cv = createCvDocument("Custom CV", { ...createEmptyResume(), name: "Candidate" });
  cv.template = { id: "custom", title: "custom", source: "", fonts: [], revision: 1, createdAt: "", updatedAt: "" };
  state.documents = [cv];
  const responses: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => responses.push(resolve)));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn().mockReturnValueOnce("blob:custom-1").mockReturnValueOnce("blob:custom-2") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Custom CV" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("link", { name: "Download CV" })).toBeNull();
  responses[0](new Response("checked PDF"));
  await waitFor(() => expect(screen.getByRole("link", { name: "Download CV" }).getAttribute("href")).toBe("blob:custom-1"));
  expect(screen.getByTestId("preview").getAttribute("data-url")).toBe("blob:custom-1");
  // Editing immediately disables downloading the obsolete draft, before debounce completes.
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Updated Candidate" } });
  expect(screen.queryByRole("link", { name: "Download CV" })).toBeNull();
  expect(screen.queryByTestId("preview")).toBeNull();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  responses[1](new Response("new checked PDF"));
  await waitFor(() => expect(screen.getByRole("link", { name: "Download CV" }).getAttribute("href")).toBe("blob:custom-2"));
  expect(screen.getByTestId("preview").getAttribute("data-url")).toBe("blob:custom-2");
});
it("retains the default renderer download for built-in CVs", async () => {
  state.documents = [createCvDocument("Default CV")];
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Default CV" }));
  expect(screen.getByRole("link", { name: "Download CV" }).getAttribute("href")).toBe("blob:default-renderer");
});
