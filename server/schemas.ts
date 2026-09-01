import { z } from "zod";

const linkSchema = z.object({ label: z.string(), url: z.string() });
const richTextSpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
const richTextBlockSchema = z.object({
  type: z.enum(["paragraph", "bullet"]),
  spans: z.array(richTextSpanSchema),
});

export const resumeDataSchema = z.object({
  name: z.string(),
  professionalTitle: z.string(),
  contact: z.object({
    address: z.string(),
    email: linkSchema,
    phone: linkSchema,
    links: z.array(linkSchema),
  }),
  profile: z.array(z.string()),
  employment: z.array(z.object({
    title: z.string(),
    dates: z.string(),
    location: z.string(),
    description: z.array(richTextBlockSchema),
  })),
  education: z.array(z.object({
    institution: z.string(),
    dates: z.string(),
    location: z.string(),
    descriptions: z.array(z.string()),
    details: z.array(z.string()),
  })),
  skills: z.array(z.string()),
  languages: z.array(z.object({
    name: z.string(),
    value: z.number().finite(),
    maximum: z.number().positive().finite(),
  })),
});

export const createCvSchema = z.object({
  title: z.string().trim().min(1).max(200).default("Untitled"),
  resume: resumeDataSchema.optional(),
  markdown: z.string().max(500_000).optional(),
  hideLanguageDots: z.boolean().default(false),
}).refine((value) => !(value.resume && value.markdown), {
  message: "Provide either resume or markdown, not both",
});

export const updateCvSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  resume: resumeDataSchema.optional(),
  markdown: z.string().max(500_000).optional(),
  hideLanguageDots: z.boolean().optional(),
  expectedRevision: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), {
  message: "At least one CV field must be provided",
}).refine((value) => !(value.resume && value.markdown), {
  message: "Provide either resume or markdown, not both",
});
