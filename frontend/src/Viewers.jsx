import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "./api";
import "./Viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export function PdfViewer({ url, page, zoom }) {
  const [pdf, setPdf] = useState(null);
  const [status, setStatus] = useState("loading");
  const [width, setWidth] = useState(0);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument(url);
    task.promise
      .then((d) => {
        if (cancelled) return;
        setPdf(d);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || width < 100) return;
    let cancelled = false;
    let renderTask = null;

    pdf
      .getPage(page)
      .then((p) => {
        if (cancelled) return null;
        const base = p.getViewport({ scale: 1 });
        const scale = ((width - 40) / base.width) * zoom;
        const viewport = p.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        if (wrapRef.current) wrapRef.current.scrollTop = 0;
        renderTask = p.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
        });
        return renderTask.promise;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdf, page, zoom, width]);

  return (
    <div className="viewer-bg" ref={wrapRef}>
      {status === "loading" && <div className="viewer-msg">Loading PDF…</div>}
      {status === "error" && <div className="viewer-msg">Could not display this PDF.</div>}
      <canvas ref={canvasRef} style={{ display: status === "ready" ? "block" : "none" }} />
    </div>
  );
}

export function TextViewer({ docId, page }) {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .pages(docId)
      .then((p) => {
        if (!cancelled) setPages(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
  }, [page]);

  const current = pages ? pages.find((p) => p.page === page) || pages[0] : null;

  return (
    <div className="viewer-bg" ref={wrapRef}>
      {error && <div className="viewer-msg">{error}</div>}
      {!error && !current && <div className="viewer-msg">Loading document…</div>}
      {current && (
        <div className="paper">
          <div className="paper-label">Page {current.page}</div>
          {current.text.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
    </div>
  );
}