import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfInspection {
  pages: Array<{ width: number; height: number }>;
  text: string;
  urls: string[];
  invisibleTextModes: number[];
  whiteTextOperations: number;
  pathOperations: number;
}

function decodePdfString(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const document = await PDFDocument.load(bytes);
  const urls: string[] = [];
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (const annotationRef of annotations.asArray()) {
      const annotation = document.context.lookup(annotationRef, PDFDict);
      const action = annotation.lookup(PDFName.of("A"), PDFDict);
      const decoded = decodePdfString(action?.get(PDFName.of("URI")));
      if (decoded) urls.push(decoded);
    }
  }

  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableFontFace: true });
  const pdf = await loadingTask.promise;
  const textPages: string[] = [];
  const invisibleTextModes: number[] = [];
  let whiteTextOperations = 0;
  let pathOperations = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    textPages.push(
      textContent.items
        .filter((item): item is typeof item & { str: string } => "str" in item)
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const ops = await page.getOperatorList();
    let fillColor: number[] | null = null;
    for (let index = 0; index < ops.fnArray.length; index += 1) {
      const fn = ops.fnArray[index];
      const args = ops.argsArray[index] as unknown[];
      if (fn === pdfjs.OPS.setTextRenderingMode) {
        const mode = Number(args[0]);
        if (mode !== 0) invisibleTextModes.push(mode);
      }
      if (fn === pdfjs.OPS.setFillRGBColor) {
        const colorArg = args.length === 1 && typeof args[0] === "object" ? args[0] : args;
        fillColor = Array.from(colorArg as ArrayLike<number>);
      }
      if (fn === pdfjs.OPS.showText && fillColor?.every((channel) => channel >= 250)) {
        whiteTextOperations += 1;
      }
      if (fn === pdfjs.OPS.constructPath) pathOperations += 1;
    }
  }
  await loadingTask.destroy();

  return {
    pages: document.getPages().map((page) => page.getSize()),
    text: textPages.join("\n"),
    urls: [...new Set(urls)],
    invisibleTextModes,
    whiteTextOperations,
    pathOperations,
  };
}
