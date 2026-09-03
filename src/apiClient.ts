import type { CvDocument } from "./cvStore";
import type { ResumeData } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface RuntimeInfo {
  ok: boolean;
  storage: "sqlite" | "postgres";
  authRequired: boolean;
  canQuit: boolean;
  apiVersion: string;
  mcpEndpoint: string;
}

export function getRuntimeInfo(): Promise<RuntimeInfo> {
  return request("/api/v1/health", { headers: {} });
}

export function createSession(token: string): Promise<{ ok: boolean }> {
  return request("/api/v1/session", { method: "POST", body: JSON.stringify({ token }) });
}

export function listCvs(): Promise<{ items: CvDocument[] }> {
  return request("/api/v1/cvs");
}

export function createCv(input: { title: string; resume?: ResumeData; hideLanguageDots?: boolean }): Promise<CvDocument> {
  return request("/api/v1/cvs", { method: "POST", body: JSON.stringify(input) });
}

export function updateCv(id: string, input: { title?: string; resume?: ResumeData; hideLanguageDots?: boolean }): Promise<CvDocument> {
  return request(`/api/v1/cvs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteCv(id: string): Promise<void> {
  return request(`/api/v1/cvs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function downloadCvPdf(cv: CvDocument): Promise<Blob> {
  const response = await fetch(`/api/v1/cvs/${encodeURIComponent(cv.id)}/pdf`, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, `Could not render ${cv.title}`);
  return response.blob();
}
