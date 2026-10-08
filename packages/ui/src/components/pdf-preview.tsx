import { useEffect, useRef, useState } from 'react';
import { ActionButton, Picker, PickerItem, ProgressCircle } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { getDocument, PDFWorker, TextLayer, type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from 'pdfjs-dist';
import Worker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { PdfBinaryData } from './pdf-assets.ts';
import { pdfScale } from '../model/file-preview.ts';
import { PANEL as M } from './panel-copy.ts';
import { S } from './shell-copy.ts';
import './pdf-preview.css';

const root = style({ display: 'flex', flexDirection: 'column', height: 'full', minHeight: 480, minWidth: 0 });
const bar = style({ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 8, flexShrink: 0 });
const scroll = style({ overflow: 'auto', flexGrow: 1, minHeight: 0, backgroundColor: 'gray-100', padding: 24 });
const paper = style({ position: 'relative', marginX: 'auto', backgroundColor: 'white', color: 'black', width: 'fit' });
const note = style({ padding: 24, font: 'ui-sm', color: 'gray-600' });

/** PDF.js 与参考 panel 一样使用独立 Worker、canvas 和可选中的文本层；仅渲染当前页。 */
export default function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState('fit');
  const [width, setWidth] = useState(600);
  const [rendering, setRendering] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setPdf(null); setError(''); setPage(1);
    let port: globalThis.Worker | undefined, worker: PDFWorker | undefined, task: PDFDocumentLoadingTask | undefined;
    try {
      port = new Worker();
      worker = PDFWorker.create({ port });
      task = getDocument({ url, worker, BinaryDataFactory: PdfBinaryData, useWorkerFetch: false,
        cMapUrl: 'bundled/', standardFontDataUrl: 'bundled/', wasmUrl: 'bundled/', useSystemFonts: true });
      task.promise.then(doc => { if (alive) setPdf(doc); }).catch((e: Error) => { if (alive) setError(e.message); });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    return () => {
      alive = false;
      const release = () => { worker?.destroy(); port?.terminate(); };
      if (task) void task.destroy().catch(() => {}).finally(release);
      else release();
    };
  }, [url]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const resize = new ResizeObserver(() => { if (el.clientWidth > 0) setWidth(el.clientWidth); });
    resize.observe(el);
    return () => resize.disconnect();
  }, [pdf]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false, render: RenderTask | undefined, layer: TextLayer | undefined;
    setRendering(true); setError('');
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled || !canvas.current || !text.current) return;
      const scale = pdfScale(p.getViewport({ scale: 1 }).width, width, zoom);
      const viewport = p.getViewport({ scale });
      const c = canvas.current, container = text.current;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      c.width = Math.ceil(viewport.width * ratio); c.height = Math.ceil(viewport.height * ratio);
      c.style.width = `${viewport.width}px`; c.style.height = `${viewport.height}px`;
      container.replaceChildren();
      container.style.setProperty('--scale-factor', String(scale));
      container.style.setProperty('--total-scale-factor', String(scale));
      render = p.render({ canvas: c, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (cancelled) return;
      layer = new TextLayer({ textContentSource: p.streamTextContent(), container, viewport });
      await layer.render();
      if (cancelled) return;
      const saved = anchor.current, el = scroller.current;
      if (saved && el) { el.scrollLeft = saved.x * el.scrollWidth / saved.width; el.scrollTop = saved.y * el.scrollHeight / saved.height; anchor.current = null; }
      setRendering(false);
    })().catch((e: Error) => { if (!cancelled) { setError(e.message); setRendering(false); } });
    return () => { cancelled = true; render?.cancel(); layer?.cancel(); };
  }, [pdf, page, zoom, width]);

  const changeZoom = (value: string) => {
    const el = scroller.current;
    if (el) anchor.current = { x: el.scrollLeft, y: el.scrollTop, width: el.scrollWidth, height: el.scrollHeight };
    setZoom(value);
  };
  if (!pdf) return <div className={note}>{error ? S.filePreview.failed(error) : <ProgressCircle isIndeterminate aria-label={S.filePreview.loading} />}</div>;
  return <section className={root} aria-label={fileName}>
    <div className={bar}>
      <ActionButton isQuiet aria-label={M.previousPage} isDisabled={page <= 1} onPress={() => { setPage(page - 1); scroller.current?.scrollTo(0, 0); }}><ChevronLeft /></ActionButton>
      <span aria-live="polite">{page} / {pdf.numPages}</span>
      <ActionButton isQuiet aria-label={M.nextPage} isDisabled={page >= pdf.numPages} onPress={() => { setPage(page + 1); scroller.current?.scrollTo(0, 0); }}><ChevronRight /></ActionButton>
      <Picker aria-label={M.zoom} selectedKey={zoom} onSelectionChange={key => changeZoom(String(key))}>
        <PickerItem id="fit">{M.fitWidth}</PickerItem>{['50', '75', '100', '125', '150', '200'].map(value => <PickerItem id={value} key={value}>{value}%</PickerItem>)}
      </Picker>
      {rendering && <ProgressCircle size="S" isIndeterminate aria-label={S.filePreview.loading} />}
    </div>
    {error && <div className={note} role="alert">{S.filePreview.failed(error)}</div>}
    <div ref={scroller} className={`${scroll} bc-scroll`}>
      <div className={paper} style={error ? { visibility: 'hidden' } : undefined}><canvas ref={canvas} aria-label={`${fileName} · ${page}`} /><div ref={text} className="bc-pdf-text textLayer" /></div>
    </div>
  </section>;
}
