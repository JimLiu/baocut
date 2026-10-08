import { describe, expect, it } from 'vitest';
import type { MediaHandle } from '@baocut/protocol';
import { resolvedPreviewMode, readPreviewText, documentPreview, formatJson, parseDelimited, pdfScale, TABLE_ROW_LIMIT } from './file-preview.ts';

describe('文件预览', () => {
  it('选择常用格式，Office 文件不冒充纯文本', () => {
    expect(['report.PDF', 'index.html', 'a.csv', 'a.tsv', 'a.json', 'a.md', 'a.docx'].map(documentPreview))
      .toEqual(['pdf', 'html', 'table', 'table', 'json', 'markdown', null]);
  });
  it('CSV 支持 BOM、CRLF、转义双引号、逗号与多行单元格；TSV 保留空列', () => {
    expect(parseDelimited('\uFEFFname,note\r\na,"one,two"\r\nb,"first\nsecond"\r\nc,"say ""hello"""\r\n', ',').rows)
      .toEqual([['name', 'note'], ['a', 'one,two'], ['b', 'first\nsecond'], ['c', 'say "hello"']]);
    expect(parseDelimited('a\tb\n1\t\n', '\t').rows).toEqual([['a', 'b'], ['1', '']]);
    expect(parseDelimited('""', ',').rows).toEqual([['']]);
  });
  it('损坏和过大的表格明确退回源码，不静默显示部分数据', () => {
    for (const input of ['a,"unfinished', 'a,"closed"oops', 'a,b"c']) expect(parseDelimited(input, ',').error).toBe('quote');
    expect(parseDelimited('a\n'.repeat(TABLE_ROW_LIMIT + 1), ',').error).toBe('limit');
    expect(parseDelimited('a,'.repeat(202), ',').error).toBe('limit');
    expect(parseDelimited(Array(201).fill('a').join(','), ',').error).toBe('limit');
    expect(parseDelimited(Array(200).fill('a').join(','), ',').error).toBeNull();
  });
  it('JSON 格式化，解析失败保留原始数据；PDF 适宽与比例缩放', () => {
    expect(formatJson('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', valid: true });
    expect(formatJson('{\"id\":12345678901234567890,\"a\":[true,{},\"a:b\"]}').text).toContain('12345678901234567890');
    expect(formatJson('{bad')).toEqual({ text: '{bad', valid: false });
    expect(pdfScale(600, 648, 'fit')).toBe(1);
    expect(pdfScale(600, 348, 'fit')).toBe(0.5);
    expect(pdfScale(600, 648, '150')).toBe(1.5);
  });
});

describe('内容事实决定预览和有界解码', () => {
  const handle = (contentKind: MediaHandle['contentKind'], mimeType = 'application/octet-stream'): MediaHandle =>
    ({ url: '/media/test', fileName: 'test.abc', size: 10, mimeType, contentKind, expiresAt: '' });
  it('文本回退、错扩展名、二进制和旧 Runtime 的回退', () => {
    expect(resolvedPreviewMode('README', handle('text'), null)).toBe('text');
    expect(resolvedPreviewMode('notes.pdf', handle('text'), 'pdf')).toBe('text');
    expect(resolvedPreviewMode('notes.txt', handle('pdf'), 'text')).toBe('pdf');
    expect(resolvedPreviewMode('notes.txt', handle('binary'), 'text')).toBeNull();
    expect(resolvedPreviewMode('clip.abc', handle('video', 'video/mp4'), null)).toBe('video');
    expect(resolvedPreviewMode('clip.abc', handle('audio', 'audio/wav'), null)).toBe('audio');
    expect(resolvedPreviewMode('config.json', handle('text'), 'json')).toBe('json');
    expect(resolvedPreviewMode('clip.mp4', handle(undefined), 'video')).toBe('video');
  });
  it('拒绝采样之后才出现的二进制与文件增长，不显示乱码或无限加载', async () => {
    expect(await readPreviewText(new Response(Uint8Array.of(65, 0, 66)))).toEqual({ error: 'binary' });
    expect(await readPreviewText(new Response(Uint8Array.of(0xff, 0xfe)))).toEqual({ error: 'binary' });
    expect(await readPreviewText(new Response('12345'), 'utf-8', 4)).toEqual({ error: 'limit' });
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')]);
    expect(await readPreviewText(new Response(le), 'utf-16le')).toEqual({ text: '你好' });
    expect(await readPreviewText(new Response(''))).toEqual({ text: '' });
  });
});
