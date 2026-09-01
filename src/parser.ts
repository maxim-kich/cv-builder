import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  Content,
  Heading,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type {
  ContactDetails,
  EducationEntry,
  EmploymentEntry,
  LanguageEntry,
  LinkValue,
  RichTextBlock,
  RichTextSpan,
  ResumeData,
} from "./types";

const REQUIRED_SECTIONS = [
  "profile",
  "employment history",
  "education",
  "skills",
  "languages",
] as const;

function textOf(node: Content | Root | PhrasingContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return node.children.map((child) => textOf(child)).join("");
  return "";
}

function normalizedHeading(node: Heading): string {
  return textOf(node).trim().toLocaleLowerCase();
}

function isHeading(node: RootContent, depth?: number): node is Heading {
  return node.type === "heading" && (depth === undefined || node.depth === depth);
}

function sectionNodes(root: Root, name: string): RootContent[] {
  const start = root.children.findIndex(
    (node) => isHeading(node, 2) && normalizedHeading(node) === name,
  );
  if (start < 0) throw new Error(`Missing required section: ${name}`);
  const end = root.children.findIndex(
    (node, index) => index > start && isHeading(node, 2),
  );
  return root.children.slice(start + 1, end < 0 ? undefined : end);
}

function splitEntryGroups(nodes: RootContent[]): Array<{ heading: Heading; body: RootContent[] }> {
  const groups: Array<{ heading: Heading; body: RootContent[] }> = [];
  for (const node of nodes) {
    if (isHeading(node, 3)) groups.push({ heading: node, body: [] });
    else if (groups.length > 0) groups.at(-1)!.body.push(node);
  }
  return groups;
}

function listItems(node: List): string[] {
  return node.children
    .filter((item): item is ListItem => item.type === "listItem")
    .map((item) => textOf(item).trim())
    .filter(Boolean);
}

function richSpans(nodes: PhrasingContent[], marks: Pick<RichTextSpan, "bold" | "italic"> = {}): RichTextSpan[] {
  return nodes.flatMap((node): RichTextSpan[] => {
    if (node.type === "text" || node.type === "inlineCode") {
      return [{ text: node.value, ...marks }];
    }
    if (node.type === "break") return [{ text: "\n", ...marks }];
    if (node.type === "strong") return richSpans(node.children, { ...marks, bold: true });
    if (node.type === "emphasis") return richSpans(node.children, { ...marks, italic: true });
    if ("children" in node) return richSpans(node.children as PhrasingContent[], marks);
    return [];
  });
}

function richTextBlocks(nodes: RootContent[]): RichTextBlock[] {
  return nodes.flatMap((node): RichTextBlock[] => {
    if (node.type === "paragraph") {
      return [{ type: "paragraph", spans: richSpans(node.children) }];
    }
    if (node.type === "list") {
      return node.children.map((item) => ({
        type: "bullet",
        spans: richSpans(
          item.children.flatMap((child) => child.type === "paragraph" ? child.children : []),
        ),
      }));
    }
    return [];
  });
}

function parseMeta(body: RootContent[], label: string, locationRequired = true): {
  dates: string;
  location: string;
  remainder: RootContent[];
} {
  const metaIndex = body.findIndex((node) => node.type === "paragraph");
  if (metaIndex < 0) throw new Error(`${label} is missing its dates and location line`);
  const meta = textOf(body[metaIndex]).trim();
  const separator = meta.indexOf("|");
  if (separator < 0) {
    if (locationRequired) throw new Error(`${label} dates and location must be separated by |`);
    return {
      dates: meta,
      location: "",
      remainder: body.filter((_, index) => index !== metaIndex),
    };
  }
  return {
    dates: meta.slice(0, separator).trim(),
    location: meta.slice(separator + 1).trim(),
    remainder: body.filter((_, index) => index !== metaIndex),
  };
}

function parseEmployment(nodes: RootContent[]): EmploymentEntry[] {
  return splitEntryGroups(nodes).map(({ heading, body }) => {
    const title = textOf(heading).trim();
    const { dates, location, remainder } = parseMeta(body, title);
    return {
      title,
      dates,
      location,
      description: richTextBlocks(remainder),
    };
  });
}

function parseEducation(nodes: RootContent[]): EducationEntry[] {
  return splitEntryGroups(nodes).map(({ heading, body }) => {
    const institution = textOf(heading).trim();
    const { dates, location, remainder } = parseMeta(body, institution, false);
    return {
      institution,
      dates,
      location,
      descriptions: remainder
        .filter((node): node is Paragraph => node.type === "paragraph")
        .map((node) => textOf(node).trim()),
      details: remainder
        .filter((node): node is List => node.type === "list")
        .flatMap(listItems),
    };
  });
}

function splitContactLines(paragraph: Paragraph): PhrasingContent[][] {
  const lines: PhrasingContent[][] = [[]];
  for (const child of paragraph.children) {
    if (child.type === "break") lines.push([]);
    else lines.at(-1)!.push(child);
  }
  return lines.filter((line) => textOf({ type: "paragraph", children: line }).trim());
}

function linksFrom(nodes: PhrasingContent[]): LinkValue[] {
  return nodes
    .filter((node): node is Link => node.type === "link")
    .map((node) => ({ label: textOf(node).trim(), url: node.url }));
}

function parseContact(nodes: RootContent[]): ContactDetails {
  const lines = nodes
    .filter((node): node is Paragraph => node.type === "paragraph")
    .flatMap(splitContactLines);
  const allLinks = lines.flatMap(linksFrom);
  const email = allLinks.find((link) => link.url.startsWith("mailto:"));
  const phone = allLinks.find((link) => link.url.startsWith("tel:"));
  if (!email || !phone) throw new Error("Contact block requires mailto and tel links");
  const addressLine = lines.find((line) => linksFrom(line).length === 0);
  const address = addressLine ? textOf({ type: "paragraph", children: addressLine }).trim() : "";
  if (!address) throw new Error("Contact block requires an address");
  return {
    address,
    email,
    phone,
    links: allLinks.filter(
      (link) => !link.url.startsWith("mailto:") && !link.url.startsWith("tel:"),
    ),
  };
}

function parseLanguages(nodes: RootContent[]): LanguageEntry[] {
  const values = nodes
    .filter((node): node is List => node.type === "list")
    .flatMap(listItems);
  return values.map((value) => {
    const match = value.match(/^(.+?):\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (!match) throw new Error(`Invalid language proficiency: ${value}`);
    const rating = Number(match[2]);
    const maximum = Number(match[3]);
    if (maximum <= 0 || rating < 0 || rating > maximum) {
      throw new Error(`Language proficiency is outside its range: ${value}`);
    }
    return { name: match[1].trim(), value: rating, maximum };
  });
}

export function parseResumeMarkdown(markdown: string): ResumeData {
  const root = fromMarkdown(markdown);
  for (const section of REQUIRED_SECTIONS) sectionNodes(root, section);

  const nameNode = root.children.find((node) => isHeading(node, 1));
  if (!nameNode || !isHeading(nameNode, 1)) throw new Error("Résumé requires a level-one name");
  const profileHeadingIndex = root.children.findIndex(
    (node) => isHeading(node, 2) && normalizedHeading(node) === "profile",
  );
  const titleIndex = root.children.findIndex(
    (node, index) => index < profileHeadingIndex && isHeading(node, 2),
  );
  if (titleIndex < 0) throw new Error("Résumé requires a level-two professional title");

  const profile = sectionNodes(root, "profile")
    .filter((node): node is Paragraph => node.type === "paragraph")
    .map((node) => textOf(node).trim());
  const skills = sectionNodes(root, "skills")
    .filter((node): node is List => node.type === "list")
    .flatMap(listItems);

  return {
    name: textOf(nameNode).trim(),
    professionalTitle: textOf(root.children[titleIndex]).trim(),
    contact: parseContact(root.children.slice(titleIndex + 1, profileHeadingIndex)),
    profile,
    employment: parseEmployment(sectionNodes(root, "employment history")),
    education: parseEducation(sectionNodes(root, "education")),
    skills,
    languages: parseLanguages(sectionNodes(root, "languages")),
  };
}

export function outputFilename(resume: Pick<ResumeData, "name" | "professionalTitle">): string {
  const slug = (value: string) => value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const description = [slug(resume.name), slug(resume.professionalTitle)].filter(Boolean).join("_");
  return `${description || "untitled"}_cv.pdf`;
}

function markdownText(spans: RichTextSpan[]): string {
  return spans.map((span) => {
    let value = span.text;
    if (span.bold) value = `**${value}**`;
    if (span.italic) value = `*${value}*`;
    return value;
  }).join("");
}

function linkMarkdown(link: LinkValue): string {
  return `[${link.label}](${link.url})`;
}

export function resumeToMarkdown(resume: ResumeData): string {
  const employment = resume.employment.map((entry) => {
    const description = entry.description.map((block) =>
      `${block.type === "bullet" ? "- " : ""}${markdownText(block.spans)}`,
    ).join("\n\n");
    return `### ${entry.title}\n\n**${entry.dates}** | ${entry.location}\n\n${description}`;
  }).join("\n\n");
  const education = resume.education.map((entry) => {
    const meta = entry.location ? `**${entry.dates}** | ${entry.location}` : `**${entry.dates}**`;
    const body = [...entry.descriptions, ...entry.details.map((detail) => `- ${detail}`)].join("\n\n");
    return `### ${entry.institution}\n\n${meta}\n\n${body}`;
  }).join("\n\n");
  const contactLinks = resume.contact.links.map(linkMarkdown).join(" | ");

  return `# ${resume.name}\n\n## ${resume.professionalTitle}\n\n${resume.contact.address}  \n${linkMarkdown(resume.contact.email)}  \n${linkMarkdown(resume.contact.phone)}  \n${contactLinks}\n\n## Profile\n\n${resume.profile.join("\n\n")}\n\n## Employment History\n\n${employment}\n\n## Education\n\n${education}\n\n## Skills\n\n${resume.skills.map((skill) => `- ${skill}`).join("\n")}\n\n## Languages\n\n${resume.languages.map((language) => `- ${language.name}: ${language.value}/${language.maximum}`).join("\n")}\n`;
}
