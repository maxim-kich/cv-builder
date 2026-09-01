import { pdf } from "@react-pdf/renderer";
import { ResumeDocument } from "./ResumeDocument";
import type { ResumeData } from "../types";

export async function renderResumeToBuffer(resume: ResumeData, options: { showLanguageDots?: boolean } = {}): Promise<Buffer> {
  const stream = await pdf(<ResumeDocument resume={resume} showLanguageDots={options.showLanguageDots} />).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
