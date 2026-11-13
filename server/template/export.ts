import type { CvDocument } from "../../src/cvStore";
import { renderResumeToBuffer } from "../../src/pdf/generate";
import { renderTemplate } from "./render";
export async function renderCv(cv: CvDocument): Promise<Buffer> {
  return cv.template ? (await renderTemplate(cv.template, cv.resume, !cv.hideLanguageDots)).pdf : renderResumeToBuffer(cv.resume, { showLanguageDots: !cv.hideLanguageDots });
}
