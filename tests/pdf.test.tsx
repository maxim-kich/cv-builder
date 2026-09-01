import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPdf, SOURCE_MARKDOWN } from "../scripts/build-pdf";
import { inspectPdf } from "../scripts/pdf-inspection";
import { parseResumeMarkdown } from "../src/parser";
import { renderResumeToBuffer } from "../src/pdf/generate";
import { LONG_BULLET_SUFFIX, withLongBullet } from "./fixtures/long-bullet";

const source = await readFile(SOURCE_MARKDOWN, "utf8");
const resume = parseResumeMarkdown(source);
const expectedUrls = [
  resume.contact.email.url,
  resume.contact.phone.url,
  ...resume.contact.links.map((link) => link.url),
];

describe("generated PDF", () => {
  it("creates a non-empty output in the requested directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resume-pdf-"));
    const output = await buildPdf(SOURCE_MARKDOWN, directory);
    expect(path.dirname(output)).toBe(directory);
    expect((await stat(output)).size).toBeGreaterThan(10_000);
  });

  it("renders the sample fixture as two A4 pages with searchable text, links, and vector graphics", async () => {
    const inspected = await inspectPdf(await renderResumeToBuffer(resume));
    expect(inspected.pages).toHaveLength(2);
    for (const page of inspected.pages) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
    }
    expect(inspected.text.trim().startsWith(`${resume.name} ${resume.professionalTitle}`)).toBe(true);
    for (let index = 1; index < resume.employment.length; index += 1) {
      expect(inspected.text.indexOf(resume.employment[index - 1].title))
        .toBeLessThan(inspected.text.indexOf(resume.employment[index].title));
    }
    expect(inspected.urls).toEqual(expect.arrayContaining(expectedUrls));
    expect(inspected.invisibleTextModes).toEqual([]);
    expect(inspected.whiteTextOperations).toBe(0);
    expect(inspected.pathOperations).toBeGreaterThanOrEqual(resume.languages.length * 5);
  }, 30_000);

  it("uses one page when the CV contains little information", async () => {
    const compactResume = {
      ...resume,
      contact: { ...resume.contact, links: [] },
      profile: resume.profile.slice(0, 1),
      employment: [],
      education: [],
      skills: [],
      languages: [],
    };
    const inspected = await inspectPdf(await renderResumeToBuffer(compactResume));
    expect(inspected.pages).toHaveLength(1);
  }, 30_000);

  it("adds more pages when the CV content outgrows the sample layout", async () => {
    const expandedResume = {
      ...resume,
      employment: Array.from({ length: 4 }, (_, repetition) =>
        resume.employment.map((entry) => ({
          ...entry,
          title: `${entry.title} — extended ${repetition + 1}`,
        })),
      ).flat(),
    };
    const inspected = await inspectPdf(await renderResumeToBuffer(expandedResume));
    expect(inspected.pages.length).toBeGreaterThan(2);
    expect(inspected.text).toContain("extended 4");
  }, 60_000);

  it("wraps a significantly longer bullet without losing its text", async () => {
    const fixture = parseResumeMarkdown(withLongBullet(source));
    const inspected = await inspectPdf(await renderResumeToBuffer(fixture));
    expect(inspected.pages).toHaveLength(2);
    expect(inspected.text).toContain(LONG_BULLET_SUFFIX.trim());
  }, 30_000);

  it("can render languages without proficiency dots", async () => {
    const withDots = await inspectPdf(await renderResumeToBuffer(resume));
    const withoutDots = await inspectPdf(await renderResumeToBuffer(resume, { showLanguageDots: false }));
    expect(withoutDots.pathOperations).toBeLessThan(withDots.pathOperations);
    for (const language of resume.languages) expect(withoutDots.text).toContain(language.name);
  }, 30_000);
});
