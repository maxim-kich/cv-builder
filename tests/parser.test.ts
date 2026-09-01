import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SOURCE_MARKDOWN } from "../scripts/build-pdf";
import { outputFilename, parseResumeMarkdown, resumeToMarkdown } from "../src/parser";

const markdown = await readFile(SOURCE_MARKDOWN, "utf8");

describe("résumé Markdown parser", () => {
  it("parses every required section and contact field", () => {
    const resume = parseResumeMarkdown(markdown);
    expect(resume.name).toBe("Alex Morgan");
    expect(resume.professionalTitle).toBe("Product Designer");
    expect(resume.contact.address).toBe("Remote");
    expect(resume.contact.email.url).toBe("mailto:alex.morgan@example.com");
    expect(resume.contact.phone.url).toBe("tel:+12025550142");
    expect(resume.profile).toHaveLength(2);
    expect(resume.education).toHaveLength(1);
    expect(resume.skills.length).toBeGreaterThan(20);
    expect(resume.languages).toHaveLength(3);
  });

  it("preserves employment entries in Markdown order", () => {
    const resume = parseResumeMarkdown(markdown);
    expect(resume.employment.map((entry) => entry.title)).toEqual([
      "Lead Product Designer — Northstar Labs",
      "Senior Product Designer — Harbor Systems",
      "Product Designer — Fieldwork Studio",
      "UX Designer — Cedar Digital",
      "Design Researcher — Civic Works",
      "Junior Interaction Designer — Common Thread",
    ]);
  });

  it("requires the declared résumé sections", () => {
    expect(() => parseResumeMarkdown(markdown.replace("## Skills", "## Capabilities")))
      .toThrow("Missing required section: skills");
  });

  it("derives a descriptive filename from source content", () => {
    expect(outputFilename(parseResumeMarkdown(markdown))).toBe(
      "alex-morgan_product-designer_cv.pdf",
    );
  });

  it("uses a safe filename for a blank new CV", () => {
    expect(outputFilename({ name: "", professionalTitle: "" })).toBe("untitled_cv.pdf");
  });

  it("round-trips structured field data through the alternative Markdown view", () => {
    const resume = parseResumeMarkdown(markdown);
    const roundTripped = parseResumeMarkdown(resumeToMarkdown(resume));
    expect(roundTripped).toEqual(resume);
  });
});
