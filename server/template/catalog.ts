import { readFile } from "node:fs/promises";
import { DEFAULT_TEMPLATE_ID, type CvTemplate } from "../../src/templates";
import type { CvStorage } from "../storage";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { TemplateError, renderTemplate } from "./render";
import { createEmptyResume } from "../../src/cvStore";
import { uploadTemplateSchema } from "./schema";

export function templateOwner(auth?: AuthInfo): string {
  if (auth?.extra?.authMethod === "oauth") {
    if (typeof auth.extra.sub !== "string" || !auth.extra.sub) throw new Error("Missing authenticated subject");
    return `oauth:${auth.extra.sub}`;
  }
  return "deployment-owner";
}
export const defaultMetadata = { id: DEFAULT_TEMPLATE_ID, title: "Classic (built-in)", revision: 1, builtIn: true };
export async function readDefaultTemplate(): Promise<CvTemplate> {
  const source = (await readFile(new URL(import.meta.url.endsWith(".ts") ? "../../src/pdf/ResumeDocument.tsx" : "./classic-template.tsx", import.meta.url), "utf8"))
    .replace(/const FONT_BASE[\s\S]*?Font.registerHyphenationCallback\([^\n]*\n/, "")
    .replace(/\n  Font,/, "");
  const fonts = await Promise.all([ ["Arimo-Regular.ttf", 400, "normal"], ["Arimo-Bold.ttf", 700, "normal"], ["Arimo-Italic.ttf", 400, "italic"], ["Arimo-BoldItalic.ttf", 700, "italic"] ].map(async ([file, weight, style]) => ({ family: "Arimo", data: (await readFile(`public/fonts/${file}`)).toString("base64"), weight: Number(weight), style: style as "normal" | "italic" })));
  return { id: DEFAULT_TEMPLATE_ID, title: defaultMetadata.title, source: source + "\nexport default ResumeDocument;", fonts, revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
export async function findTemplate(storage: CvStorage, owner: string, id: string) {
  return id === DEFAULT_TEMPLATE_ID ? readDefaultTemplate() : storage.getTemplate(owner, id);
}
export async function uploadTemplate(storage: CvStorage, owner: string, input: unknown) {
  const parsed = uploadTemplateSchema.parse(input);
  const { copyFontsFrom, ...data } = parsed;
  if (copyFontsFrom) {
    const base = await findTemplate(storage, owner, copyFontsFrom);
    if (!base) throw new TemplateError("Font source template is unavailable");
    data.fonts = [...base.fonts, ...data.fonts];
    // Revalidate combined package limits after owner-scoped font reuse.
    uploadTemplateSchema.parse(data);
  }
  const candidate: CvTemplate = { ...data, id: "validation", revision: 1, createdAt: "", updatedAt: "" };
  const compact = { ...createEmptyResume(), name: "Morgan Taylor", professionalTitle: "Product Designer", contact: { address: "Berlin, Germany", email: { label: "morgan@example.com", url: "mailto:morgan@example.com" }, phone: { label: "+49 30 123456", url: "tel:+4930123456" }, links: [{ label: "Portfolio", url: "https://example.com" }] }, profile: ["Designing useful products with research and collaboration."], employment: [{ title: "Senior Designer, Northstar GmbH", dates: "2022–Present", location: "Berlin", description: [{ type: "paragraph" as const, spans: [{ text: "Led product discovery and delivery." }] }, { type: "bullet" as const, spans: [{ text: "Improved onboarding and accessibility." }] }] }], education: [{ institution: "University of Design", dates: "2016–2020", location: "Hamburg", descriptions: ["Bachelor of Design"], details: ["Interaction design"] }], skills: ["Research", "Prototyping"], languages: [{ name: "English", value: 5, maximum: 5 }] };
  const report = (await renderTemplate(candidate, compact)).report;
  const long = { ...compact, profile: Array.from({ length: 8 }, (_, i) => `Profile paragraph ${i + 1}: ${compact.profile[0].repeat(8)}`), employment: Array.from({ length: 8 }, (_, i) => ({ ...compact.employment[0], title: `Designer role ${i + 1}, Northstar GmbH` })) };
  const longReport = (await renderTemplate(candidate, long)).report;
  const template = await storage.createTemplate(owner, data);
  return { template, checks: { compact: report, long: longReport } };
}

export function templateForAgent(template: CvTemplate) {
  return { ...template, copyFontsFrom: template.id, fonts: template.fonts.map(({ data, ...font }) => ({ ...font, bytes: Math.floor(data.length * 3 / 4) })) };
}
export function cvForAgent<T extends { template?: CvTemplate }>(cv: T) {
  return cv.template ? { ...cv, template: { id: cv.template.id, title: cv.template.title, revision: cv.template.revision, fontFamilies: [...new Set(cv.template.fonts.map(f => f.family))] } } : cv;
}
