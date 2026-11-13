import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ResumeData } from "../../src/types";
export interface ParsingReport {
  status: "passed" | "failed";
  missingText: string[];
  warnings: string[];
  pages: number;
}
export function requiredText(resume: ResumeData): string[] {
  return [resume.name, resume.professionalTitle, resume.contact.address, resume.contact.email.label, resume.contact.phone.label,
    ...resume.contact.links.map(l => l.label), ...resume.profile,
    ...resume.employment.flatMap(e => [e.title, e.dates, e.location, ...e.description.map(b => b.spans.map(s => s.text).join(""))]),
    ...resume.education.flatMap(e => [e.institution, e.dates, e.location, ...e.descriptions, ...e.details]),
    ...resume.skills, ...resume.languages.map(l => l.name)].filter(s => s.trim());
}
function normalize(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
export async function checkPdf(bytes: Uint8Array, resume: ResumeData): Promise<ParsingReport> {
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableFontFace: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error("PDF exceeds 30-page limit");
    let text = "";
    let outsidePage = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + " ";
        const [x, y] = [item.transform[4], item.transform[5]];
        if (x < -1 || y < -1 || x + item.width > page.view[2] + 2 || y > page.view[3] + 2) outsidePage = true;
      }
    }
    const normalized = normalize(text);
    const missingText = requiredText(resume).filter(value => !normalized.includes(normalize(value)));
    const warnings = ["Parsing checks are not ATS certification. Review reading order, columns, contrast and visual overlap; different ATS parsers may behave differently."];
    if (bytes.length > 2_500_000) warnings.push("PDF exceeds 2.5 MB; some ATS parsers reject large files.");
    if (outsidePage) warnings.push("Text extends beyond page bounds.");
    return { status: missingText.length || outsidePage ? "failed" : "passed", missingText, warnings, pages: pdf.numPages };
  } finally { await task.destroy(); }
}
