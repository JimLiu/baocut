import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { classifyFileContent, inspectFileContent, FILE_SAMPLE_BYTES } from './file-content.ts';

const utf8 = (text: string) => new TextEncoder().encode(text);
const classify = (bytes: Uint8Array, name = 'file.unknown', complete = true) => classifyFileContent(bytes, complete, name);

describe('文件内容采样', () => {
  it('未知扩展名与无扩展名的多语言文本、空文件可以查看', async () => {
    for (const name of ['README', '说明.abc', 'pretend.mp4']) {
      expect(await classify(utf8('中文 English العربية 日本語\n'), name)).toMatchObject({ contentKind: 'text', textEncoding: 'utf-8' });
    }
    expect(await classify(utf8(''))).toMatchObject({ contentKind: 'text' });
  });
  it('图片、PDF、音频与视频按内容识别，不信伪装扩展名', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6J1sAAAAASUVORK5CYII=', 'base64');
    expect(await classify(png, 'data.txt')).toMatchObject({ contentKind: 'image', mimeType: 'image/png' });
    expect(await classify(utf8('%PDF-1.7\nfixture'), 'report.abc')).toMatchObject({ contentKind: 'pdf' });
    const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00', 'binary');
    expect(await classify(wav, 'audio.bin')).toMatchObject({ contentKind: 'audio', mimeType: 'audio/wav' });
    const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
    expect(await classify(mp4, 'clip.txt')).toMatchObject({ contentKind: 'video', mimeType: 'video/mp4' });
  });
  it('二进制与压缩包不当文本，压缩包不解压', async () => {
    expect(await classify(Uint8Array.of(0, 1, 2), 'notes.txt')).toMatchObject({ contentKind: 'binary' });
    expect(await classify(Uint8Array.of(0xff, 0x80, 0x01))).toMatchObject({ contentKind: 'binary' });
    expect(await classify(Uint8Array.of(0x50, 0x4b, 3, 4), 'report.docx')).toEqual({ contentKind: 'archive', mimeType: 'application/zip' });
  });
  it('UTF-16 BOM 与截在 UTF-8 字符中间的前缀，不误报二进制', async () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好\nhello', 'utf16le')]);
    expect(await classify(le)).toMatchObject({ contentKind: 'text', textEncoding: 'utf-16le' });
    const be = Buffer.from(le); be.swap16();
    expect(await classify(be)).toMatchObject({ contentKind: 'text', textEncoding: 'utf-16be' });
    const truncated = utf8('一二三').subarray(0, 8);
    expect(await classify(truncated, 'readme', false)).toMatchObject({ contentKind: 'text' });
    expect(await classify(truncated)).toMatchObject({ contentKind: 'binary' });
  });
  it('SVG 和 HTML 内容识别，但不执行或联网', async () => {
    expect(await classify(utf8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ contentKind: 'image', mimeType: 'image/svg+xml' });
    expect(await classify(utf8('<!doctype html><html><script>throw 1</script></html>'))).toMatchObject({ contentKind: 'text', mimeType: 'text/html; charset=utf-8' });
  });
});

describe('采样有界与文件错误', () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });
  it('只读取前 64 KiB；不存在或变为符号链接的路径报错', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-file-content-'));
    const file = path.join(dir, 'huge.bin');
    await fs.writeFile(file, Buffer.concat([Buffer.alloc(FILE_SAMPLE_BYTES, 65), Buffer.from([0])]));
    expect(await inspectFileContent(file, FILE_SAMPLE_BYTES + 1)).toMatchObject({ contentKind: 'text' });
    await expect(inspectFileContent(path.join(dir, 'missing'), 1)).rejects.toThrow();
    if (process.platform !== 'win32') {
      const link = path.join(dir, 'link'); await fs.symlink(file, link);
      await expect(inspectFileContent(link, FILE_SAMPLE_BYTES + 1)).rejects.toThrow();
    }
  });
});
