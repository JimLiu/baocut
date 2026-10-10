import { useEffect, useMemo, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import type { MediaTarget } from '@baocut/protocol';
import DOMPurify from 'dompurify';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatJson, parseDelimited, type DocumentPreview } from '../model/file-preview.ts';
import { PANEL as M } from './panel-copy.ts';
import { S } from './shell-copy.ts';
import { remarkPlugins } from './thread/remark-plugins.ts';
import { siblingMediaTarget, relativeImagePath } from '../model/document-image.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useDirectory } from '../state/directory-store.ts';
import { useSpace } from '../state/space-store.ts';

const sourceBox = style({ margin: 0, paddingY: 16, font: 'code-sm', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' });
const line = style({ display: 'flex', paddingEnd: 16 });
const lineNo = style({ width: 40, paddingEnd: 16, flexShrink: 0, textAlign: 'end', color: 'gray-500', userSelect: 'none' });
const table = style({ width: 'full', borderCollapse: 'collapse', font: 'ui', textAlign: 'start' });
const cell = style({ padding: 12, borderBottomWidth: 1, borderBottomStyle: 'solid', borderColor: 'gray-100', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 80 });
const head = style({ position: 'sticky', top: 0, backgroundColor: 'gray-75' });
const message = style({ padding: 16, font: 'ui-sm', color: 'gray-600' });
const document = style({ padding: 16, userSelect: 'text' });

export function SourcePreview({ text }: { text: string }) {
  const lines = text.split('\n', 10_001);
  if (lines.length > 10_000) return <div className={message}>{S.filePreview.tooLarge}</div>;
  return <pre className={sourceBox}><code>{lines.map((text, i) => <span className={line} key={i}>
    <span className={lineNo} aria-hidden="true">{i + 1}</span><span>{text || '\n'}</span>
  </span>)}</code></pre>;
}

/** 静态 HTML：保留排版，禁脚本、表单与导航；资源仅允许内嵌图片和字体，不带应用身份。 */
export function isolatedHtml(text: string): string {
  const clean = DOMPurify.sanitize(text, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'base', 'meta', 'link'],
    FORBID_ATTR: ['href', 'srcset', 'action', 'formaction', 'xlink:href', 'ping', 'target', 'download'],
  });
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">`;
  return clean.replace(/<head>/i, `<head>${policy}`);
}

/**
 * Markdown 文章里的图片：相对路径按文章所在目录解析（`siblingMediaTarget`），经 `media.resolve` 取受限句柄显示，取不到时
 * 显示替代文字；带协议的地址照原来的方式交给 `<img>`（地址已经过 react-markdown 的默认过滤）。
 */
function DocumentImage({ src, alt, base }: { src?: string; alt?: string; base?: MediaTarget }) {
  const runtime = useRuntime();
  const [url, setUrl] = useState<string | null | 'failed'>(null);
  const local = !!src && relativeImagePath(src) !== null;
  useEffect(() => {
    if (!src || !local) return;
    let cancelled = false;
    setUrl(null);
    const target = base
      ? siblingMediaTarget(base, src, { entries: useSpace.getState().entries, dirs: useDirectory.getState(), desktop: !!runtime.host.openFile })
      : null;
    if (!target) {
      setUrl('failed');
      return;
    }
    runtime.resolveMedia(target).then(
      (handle) => { if (!cancelled) setUrl(handle.contentKind === 'image' || handle.mimeType.startsWith('image/') ? handle.url : 'failed'); },
      () => { if (!cancelled) setUrl('failed'); },
    );
    return () => { cancelled = true; };
    // base 由 JSON 唯一确定，不把每次新建的对象放进依赖。
  }, [runtime, src, local, base && JSON.stringify(base)]);
  if (!src) return alt ? <span>{alt}</span> : null;
  if (!local) return <img src={src} alt={alt ?? ''} />;
  if (url === 'failed') return alt ? <span>{alt}</span> : null;
  return url ? <img src={url} alt={alt ?? ''} /> : null;
}

export function DocumentContent({ mode, fileName, text, source, target }: { mode: DocumentPreview; fileName: string; text: string; source: boolean; target?: MediaTarget }) {
  const markdownComponents = useMemo<Components>(() => ({
    a: ({ children }) => <span>{children}</span>,
    img: ({ src, alt }) => <DocumentImage src={typeof src === 'string' ? src : undefined} alt={alt} base={target} />,
  }), [target && JSON.stringify(target)]);
  const html = useMemo(() => mode === 'html' ? isolatedHtml(text) : '', [mode, text]);
  const data = useMemo(() => mode === 'table' ? parseDelimited(text, /\.tsv$/i.test(fileName) ? '\t' : ',') : null, [mode, text, fileName]);
  const json = useMemo(() => mode === 'json' ? formatJson(text) : null, [mode, text]);
  if (source) return <SourcePreview text={text} />;
  if (mode === 'html') return <iframe title={fileName} sandbox="" referrerPolicy="no-referrer" srcDoc={html} style={{ display: 'block', width: '100%', height: '100%', minHeight: 480, border: 0, background: 'white' }} />;
  if (mode === 'markdown') return <div className={`${document} bc-md`}><Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>{text}</Markdown></div>;
  if (data && !data.error) {
    const columns = Math.max(0, ...data.rows.map(row => row.length));
    return <table className={table} aria-label={fileName}><thead className={head}><tr><th className={cell} aria-label="#">#</th>
      {Array.from({ length: columns }, (_, i) => <th className={cell} scope="col" key={i}>{data.rows[0]?.[i] || M.column(i + 1)}</th>)}
    </tr></thead><tbody>{data.rows.slice(1).map((row, i) => <tr key={i}><th className={cell} scope="row">{i + 1}</th>
      {Array.from({ length: columns }, (_, j) => <td className={cell} key={j}>{row[j] ?? ''}</td>)}
    </tr>)}</tbody></table>;
  }
  return <>{data?.error || json?.valid === false ? <div className={message} role="status">{data?.error === 'limit' ? S.filePreview.tooLarge : data?.error ? M.csvInvalid : M.jsonInvalid}</div> : null}
    <SourcePreview text={json?.text ?? text} />
  </>;
}
