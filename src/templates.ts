// Shared data contracts only. Uploaded source is never executed in the browser.
export interface TemplateFont {
  family: string;
  data: string;
  weight: number;
  style: "normal" | "italic";
}
export interface CvTemplate {
  id: string;
  title: string;
  source: string;
  fonts: TemplateFont[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export const DEFAULT_TEMPLATE_ID = "builtin:classic";
