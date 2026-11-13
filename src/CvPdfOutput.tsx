import { PdfPreview } from "./PdfPreview";
// One resolved URL feeds both controls so downloads cannot silently use another renderer.
export function CvPdfDownload({ url, filename }: { url: string | null | undefined; filename: string }) {
  return url ? <a className="download-button" href={url} download={filename}>Download CV</a> : <button className="download-button" disabled>Rendering PDF…</button>;
}
export function CvPdfPreview({ url }: { url: string | null | undefined }) {
  return url ? <PdfPreview url={url} /> : <div className="preview-placeholder" aria-live="polite">Rendering preview…</div>;
}
