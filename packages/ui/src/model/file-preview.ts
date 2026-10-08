import type { MediaHandle } from '@baocut/protocol';
export type DocumentPreview = 'pdf' | 'html' | 'table' | 'json' | 'markdown' | 'text';
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export const PDF_PREVIEW_LIMIT = 100 * 1024 * 1024;
export const TABLE_ROW_LIMIT = 2000;

export function documentPreview(name: string): DocumentPreview | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'csv' || ext === 'tsv') return 'table';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return null;
}

/** RFC 4180 的引号、转义双引号与多行单元格；有界渲染，不截断后冒充完整表格。 */
export function parseDelimited(text: string, delimiter: ',' | '\t'): { rows: string[][]; error: 'quote' | 'limit' | null } {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!cell && !closed) quoted = true;
      else return { rows: [], error: 'quote' };
    } else if (ch === delimiter && !quoted) {
      row.push(cell); cell = ''; closed = false;
      if (row.length > 200) return { rows: [], error: 'limit' };
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.length > 200) return { rows: [], error: 'limit' };
      rows.push(row); row = []; cell = ''; closed = false;
      if (rows.length > TABLE_ROW_LIMIT) return { rows: [], error: 'limit' };
    } else {
      if (closed) return { rows: [], error: 'quote' };
      cell += ch;
    }
  }
  if (quoted) return { rows: [], error: 'quote' };
  if (cell || row.length || closed) {
    row.push(cell);
    if (row.length > 200) return { rows: [], error: 'limit' };
    rows.push(row);
  }
  return rows.length > TABLE_ROW_LIMIT ? { rows: [], error: 'limit' } : { rows, error: null };
}

export function formatJson(text: string): { text: string; valid: boolean } {
  try {
    JSON.parse(text); // 只校验；格式化保留数字字面量，避免长整数 ID 被浮点数改写。
    const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
    let output = '', depth = 0;
    const newline = () => '\n' + '  '.repeat(depth);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token === '{' || token === '[') {
        output += token; depth++;
        if (depth > 100) return { text, valid: true };
        if (tokens[i + 1] !== (token === '{' ? '}' : ']')) output += newline();
      } else if (token === '}' || token === ']') {
        depth--;
        if (tokens[i - 1] !== (token === '}' ? '{' : '[')) output += newline();
        output += token;
      } else if (token === ',') output += ',' + newline();
      else if (token === ':') output += ': ';
      else output += token;
    }
    return { text: output, valid: true };
  }
  catch { return { text, valid: false }; }
}

export function pdfScale(pageWidth: number, available: number, zoom: string): number {
  return zoom === 'fit' ? Math.max(0.1, (available - 48) / pageWidth) : Math.max(0.25, Math.min(3, Number(zoom) / 100));
}

export type FilePreviewMode = DocumentPreview | 'image' | 'video' | 'audio';
/** Runtime 的内容事实优先于扩展名；旧 Runtime 保留原有按扩展名回退。 */
export function resolvedPreviewMode(name: string, handle: MediaHandle, legacy: FilePreviewMode | null): FilePreviewMode | null {
  switch (handle.contentKind) {
    case 'text': {
      const mode = documentPreview(name);
      if (mode && mode !== 'pdf') return mode;
      return handle.mimeType.startsWith('text/html') ? 'html' : 'text';
    }
    case 'pdf': return 'pdf';
    case 'image': return /image\/(?:heic|heif|tiff|vnd\.adobe)/i.test(handle.mimeType) ? null : 'image';
    case 'audio': return 'audio';
    case 'video': return /video\/(?:x-msvideo|vnd\.avi)/i.test(handle.mimeType) ? null : 'video';
    case 'archive':
    case 'binary': return null;
    default: return legacy;
  }
}

/** 文件可能在发句柄后增长；消费响应时再次限制总量，不把不可信长度交给 arrayBuffer()。 */
export async function readPreviewText(response: Response, encoding = 'utf-8', limit = TEXT_PREVIEW_LIMIT): Promise<{ text: string } | { error: 'limit' | 'binary' }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '' };
  let count = 0, text = '';
  const decoder = new TextDecoder(encoding, { fatal: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > limit) { await reader.cancel(); return { error: 'limit' }; }
      try { text += decoder.decode(chunk.value, { stream: true }); }
      catch { await reader.cancel(); return { error: 'binary' }; }
    }
    try { text += decoder.decode(); } catch { return { error: 'binary' }; }
    return /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(text) ? { error: 'binary' } : { text };
  } finally { reader.releaseLock(); }
}
