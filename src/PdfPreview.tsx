import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function PdfPreview({ url }: { url?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderIdRef = useRef(0);
  const [hasPreview, setHasPreview] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !viewerElementRef.current) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({
      container: containerRef.current,
      viewer: viewerElementRef.current,
      eventBus,
      linkService,
      removePageBorders: true,
    });
    linkService.setViewer(viewer);
    viewerRef.current = viewer;
    linkServiceRef.current = linkService;
    const resizeObserver = new ResizeObserver(() => {
      if (!viewer.pdfDocument) return;
      viewer.currentScaleValue = "page-width";
      containerRef.current?.scrollTo({ left: 0 });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      viewerRef.current = null;
      linkServiceRef.current = null;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const linkService = linkServiceRef.current;
    const container = containerRef.current;
    if (!url || !viewer || !linkService || !container) return;

    const renderId = ++renderIdRef.current;
    const loadingTask = getDocument({ url });
    let cancelled = false;
    setIsRendering(true);
    setError(null);

    void (async () => {
      try {
        const pdf = await loadingTask.promise;
        if (cancelled || renderId !== renderIdRef.current) {
          await loadingTask.destroy();
          return;
        }

        const scrollTop = container.scrollTop;
        const previousLoadingTask = loadingTaskRef.current;
        loadingTaskRef.current = loadingTask;
        viewer.setDocument(pdf);
        linkService.setDocument(pdf);
        await viewer.firstPagePromise;
        viewer.currentScaleValue = "page-width";
        await viewer.pagesPromise;

        if (cancelled || renderId !== renderIdRef.current) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            container.scrollTop = scrollTop;
            container.scrollLeft = 0;
          });
        });
        setHasPreview(true);
        if (previousLoadingTask && previousLoadingTask !== loadingTask) {
          await previousLoadingTask.destroy();
        }
      } catch (renderError) {
        if (cancelled || renderId !== renderIdRef.current) return;
        setError(renderError instanceof Error ? renderError.message : "Could not render the PDF preview.");
      } finally {
        if (!cancelled && renderId === renderIdRef.current) setIsRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  return <div className="preview-canvas" ref={containerRef}>
    <div className="pdfViewer" ref={viewerElementRef} />
    {!hasPreview && !error ? <div className="preview-placeholder" aria-live="polite">Rendering preview…</div> : null}
    {error ? <div className="preview-placeholder preview-error" role="alert">{error}</div> : null}
    {hasPreview && isRendering ? <span className="preview-rendering" aria-live="polite">Updating preview…</span> : null}
  </div>;
}
