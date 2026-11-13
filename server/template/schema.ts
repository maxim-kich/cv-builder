import { z } from "zod";
export const fontSchema = z.object({
  family: z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/),
  data: z.string().min(16).max(1_400_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  weight: z.number().int().min(100).max(900).default(400),
  style: z.enum(["normal", "italic"]).default("normal"),
}).strict();
export const uploadTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  source: z.string().min(1).max(100_000),
  copyFontsFrom: z.string().min(1).max(200).optional(),
  fonts: z.array(fontSchema).max(8).default([]),
}).strict().refine(v => v.fonts.reduce((n, f) => n + f.data.length, 0) <= 5_600_000, "Fonts exceed package limit");
export const deleteTemplateSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
