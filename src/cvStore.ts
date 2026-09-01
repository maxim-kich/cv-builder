import type { ResumeData } from "./types";

export interface CvDocument {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  resume: ResumeData;
  hideLanguageDots: boolean;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyResume(): ResumeData {
  return {
    name: "",
    professionalTitle: "",
    contact: {
      address: "",
      email: { label: "", url: "mailto:" },
      phone: { label: "", url: "tel:" },
      links: [],
    },
    profile: [],
    employment: [],
    education: [],
    skills: [],
    languages: [],
  };
}

export function createCvDocument(
  title = "Untitled",
  resume: ResumeData = createEmptyResume(),
  now = new Date(),
): CvDocument {
  return {
    id: createId(),
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    resume,
    hideLanguageDots: false,
  };
}
