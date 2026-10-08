import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_SCRIPTS, fontScriptsOf } from '@baocut/protocol';
import { FontCatalogue, defaultFaces, snapFace } from './font-catalogue.ts';
import { FontDownloadError, fetchFontFile, fetchFontText } from './font-download.ts';
import { cssUrl, parseFontFaceCss, underEndpoint } from './google-fonts-css.ts';

/** 字体目录、CSS 接口的请求与回应、下载的上限（架构设计 §9.1）。不联网：下载用本机的假服务。 */

describe('随应用发布的字体目录', () => {
  const catalogue = FontCatalogue.builtin();

  it('有日期、上千个族，每个族有分类、文字、字重与开源许可；族名不重复', () => {
    expect(catalogue.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const families = catalogue.families();
    expect(families.length).toBeGreaterThan(1500);
    expect(new Set(families.map((f) => f.family.toLowerCase())).size).toBe(families.length);
    for (const f of families) {
      expect(['OFL-1.1', 'Apache-2.0', 'UFL-1.0'], f.family).toContain(f.licence);
      expect(f.weights.length + f.italics.length, f.family).toBeGreaterThan(0);
      expect(Array.isArray(f.subsets), f.family).toBe(true);
    }
    // 中日韩的族是整个文件下载的（几 MB 到二十来 MB）。
    expect(catalogue.get('noto sans jp')).toMatchObject({ family: 'Noto Sans JP', scripts: expect.arrayContaining(['japanese']) });
    expect(catalogue.get('Noto Sans KR')!.scripts).toContain('korean');
    expect(catalogue.get('LXGW WenKai TC') ?? catalogue.get('Noto Serif SC')).toBeTruthy();
    expect(families.filter((f) => f.scripts.includes('chinese')).length).toBeGreaterThan(10);
  });

  it('文字按子集归类：中文的几个子集都算中文，不认识的子集归到 other', () => {
    expect(fontScriptsOf(['chinese-simplified', 'chinese-hongkong', 'latin', 'latin-ext', 'symbols'])).toEqual([
      'chinese',
      'latin',
      'other',
    ]);
    expect(FONT_SCRIPTS).toContain('japanese');
  });

  it('目录格式不对时拒绝；坏条目跳过', () => {
    expect(() => FontCatalogue.parse({ schema: 'x', families: [] })).toThrow();
    const parsed = FontCatalogue.parse({
      schema: 'baocut.google-fonts-catalogue/1',
      families: [{ f: 'Good', c: 'serif', s: ['latin'], w: [400], l: 'OFL-1.1' }, { f: '', c: 'serif' }, { nope: 1 }],
    });
    expect(parsed.families().map((f) => f.family)).toEqual(['Good']);
  });
});

describe('按目录对字重', () => {
  const entry = FontCatalogue.parse({
    schema: 'baocut.google-fonts-catalogue/1',
    families: [
      { f: 'Several', c: 'serif', s: ['latin'], w: [300, 400, 600, 900], i: [400], l: 'OFL-1.1' },
      { f: 'Italic Only', c: 'handwriting', s: ['latin'], w: [], i: [400], l: 'OFL-1.1' },
      { f: 'Heavy', c: 'display', s: ['latin'], w: [700, 900], l: 'OFL-1.1' },
    ],
  });
  const several = entry.get('Several')!;

  it('与 CSS 的字体匹配相同：400–500 先往上到 500 再往下，<400 先往下，>500 先往上；斜体有就挑斜体', () => {
    expect(snapFace(several, 400, false)).toEqual({ weight: 400, italic: false });
    expect(snapFace(several, 500, false)).toEqual({ weight: 400, italic: false });
    expect(snapFace(several, 200, false)).toEqual({ weight: 300, italic: false });
    expect(snapFace(several, 700, false)).toEqual({ weight: 900, italic: false });
    expect(snapFace(several, 700, true)).toEqual({ weight: 400, italic: true });
    expect(snapFace(entry.get('Italic Only')!, 400, false)).toEqual({ weight: 400, italic: true });
    expect(snapFace(entry.get('Heavy')!, 400, true)).toEqual({ weight: 700, italic: false });
  });

  it('没说要哪些 face 时下载常规与粗体，对好之后相同的只算一次', () => {
    expect(defaultFaces(several)).toEqual([
      { weight: 400, italic: false },
      { weight: 900, italic: false },
    ]);
    expect(defaultFaces(entry.get('Heavy')!)).toEqual([{ weight: 700, italic: false }]);
  });
});

describe('CSS 接口', () => {
  it('请求只带族名与字重、斜体，取值按（斜体、字重）升序', () => {
    expect(cssUrl('https://fonts.googleapis.com/', 'Noto Sans SC', [{ weight: 700, italic: false }])).toBe(
      'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@700',
    );
    expect(
      cssUrl('https://mirror.example/fonts', 'Playfair Display', [
        { weight: 400, italic: true },
        { weight: 700, italic: false },
        { weight: 400, italic: false },
        { weight: 700, italic: false },
      ]),
    ).toBe('https://mirror.example/fonts/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400');
  });

  it('读出 @font-face：族名、字重范围、斜体、地址、格式与是否分片', () => {
    const css = `/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v39/abc.ttf) format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/inter/v1/x.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face { font-family: 'Broken'; }`;
    expect(parseFontFaceCss(css)).toEqual([
      {
        family: 'Playfair Display',
        weight: [400, 400],
        italic: true,
        url: 'https://fonts.gstatic.com/s/playfairdisplay/v39/abc.ttf',
        format: 'truetype',
        partial: false,
      },
      {
        family: 'Inter',
        weight: [100, 900],
        italic: false,
        url: 'https://fonts.gstatic.com/s/inter/v1/x.woff2',
        format: 'woff2',
        partial: true,
      },
    ]);
  });

  it('文件地址只认 https、同一个源、在基址的路径之下、不带账号', () => {
    expect(underEndpoint('https://fonts.gstatic.com/s/a/1.ttf', 'https://fonts.gstatic.com')).toBe(true);
    expect(underEndpoint('https://m.example/fonts/s/a.ttf', 'https://m.example/fonts/')).toBe(true);
    expect(underEndpoint('https://m.example/other/a.ttf', 'https://m.example/fonts')).toBe(false);
    expect(underEndpoint('http://fonts.gstatic.com/s/a/1.ttf', 'https://fonts.gstatic.com')).toBe(false);
    expect(underEndpoint('https://evil.example/s/a/1.ttf', 'https://fonts.gstatic.com')).toBe(false);
    expect(underEndpoint('https://u:p@fonts.gstatic.com/s/a/1.ttf', 'https://fonts.gstatic.com')).toBe(false);
    expect(underEndpoint('not a url', 'https://fonts.gstatic.com')).toBe(false);
  });
});

describe('下载的上限与跳转', () => {
  async function serve(handler: http.RequestListener): Promise<{ url: string; close(): Promise<void> }> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
    };
  }

  it('声明或实际超过上限的不收（INTEGRITY）；跳转不跟（SOURCE）；地址不进错误信息', async () => {
    const server = await serve((req, res) => {
      req.url = req.url!.replace(/\?.*$/, '');
      if (req.url === '/declared') return void res.writeHead(200, { 'content-length': 5000 }).end(Buffer.alloc(5000));
      if (req.url === '/chunked') {
        res.writeHead(200);
        res.write(Buffer.alloc(3000));
        return void res.end(Buffer.alloc(3000));
      }
      if (req.url === '/redirect') return void res.writeHead(302, { location: 'https://evil.example/x.ttf' }).end();
      res.writeHead(200).end('ok');
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-font-download-'));
    try {
      const request = (url: string) => ({
        url: `${server.url}${url}?token=secret`,
        what: '测试字体',
        maxBytes: 4096,
        signal: new AbortController().signal,
      });
      for (const url of ['/declared', '/chunked']) {
        const error = await fetchFontFile(request(url), path.join(dir, 'f'), { retries: 0 }).catch((e: unknown) => e);
        expect(error, url).toBeInstanceOf(FontDownloadError);
        expect((error as FontDownloadError).code, url).toBe('FONT_DOWNLOAD_INTEGRITY');
      }
      const redirect = (await fetchFontText(request('/redirect'), { retries: 0 }).catch((e: unknown) => e)) as FontDownloadError;
      expect(redirect.code).toBe('FONT_DOWNLOAD_SOURCE');
      expect(redirect.message).not.toContain('secret');
      expect(redirect.message).not.toContain('127.0.0.1');
      expect(await fetchFontText(request('/ok'))).toBe('ok');
      const offline = (await fetchFontText(
        { ...request('/ok'), url: 'http://127.0.0.1:1/x?token=secret' },
        { retries: 1, backoffMs: () => 1 },
      ).catch((e: unknown) => e)) as FontDownloadError;
      expect(offline.code).toBe('FONT_DOWNLOAD_NETWORK');
      expect(offline.details).toMatchObject({ attempts: 2 });
      expect(offline.message).not.toContain('secret');
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
