import { useMemo } from 'react';
import Markdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatJson, parseDelimited, type DocumentPreview } from '../model/file-preview.ts';
import { PANEL as M } from './panel-copy.ts';
import { S } from './shell-copy.ts';
import { remarkPlugins } from './thread/remark-plugins.ts';

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

export function DocumentContent({ mode, fileName, text, source }: { mode: DocumentPreview; fileName: string; text: string; source: boolean }) {
  const html = useMemo(() => mode === 'html' ? isolatedHtml(text) : '', [mode, text]);
  const data = useMemo(() => mode === 'table' ? parseDelimited(text, /\.tsv$/i.test(fileName) ? '\t' : ',') : null, [mode, text, fileName]);
  const json = useMemo(() => mode === 'json' ? formatJson(text) : null, [mode, text]);
  if (source) return <SourcePreview text={text} />;
  if (mode === 'html') return <iframe title={fileName} sandbox="" referrerPolicy="no-referrer" srcDoc={html} style={{ display: 'block', width: '100%', height: '100%', minHeight: 480, border: 0, background: 'white' }} />;
  if (mode === 'markdown') return <div className={`${document} bc-md`}><Markdown remarkPlugins={remarkPlugins} components={{ a: ({ children }) => <span>{children}</span> }}>{text}</Markdown></div>;
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
