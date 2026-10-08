import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { JobManager, type JobVideos, type TranscribeRouter } from '@baocut/jobs';
import { ModelCatalog } from '@baocut/models';
import { RpcError, type FontDownloadErrorCode, type FontFaceQuery } from '@baocut/protocol';
import type { LocalFontFaces } from '../videos/video-service.ts';
import { familySlug } from './font-cache.ts';
import { FontCatalogue } from './font-catalogue.ts';
import { FONT_DOWNLOAD_REMEDIES } from './font-download.ts';
import { FontService, type FontSettings } from './font-service.ts';

/**
 * 按需下载的字体（架构设计 §9.1）：Runtime 侧的下载、缓存、去重、失败、取消与删除。字体服务是本机的假服务
 * （把 https 的 Google Fonts 地址改写到 127.0.0.1），引擎是假的：「字体文件」是 `FONT:<族名>` 开头的字节，
 * 不是这个开头的当作解析不了。真实引擎的核对与成片导出在 `font-engine.test.ts` 与成片导出的端到端测试里。
 */

const CATALOGUE = FontCatalogue.parse({
  schema: 'baocut.google-fonts-catalogue/1',
  generatedAt: '2026-10-04',
  families: [
    { f: 'Lobster', c: 'display', s: ['cyrillic', 'latin', 'latin-ext', 'vietnamese'], w: [400], l: 'OFL-1.1' },
    { f: 'Noto Serif JP', c: 'serif', s: ['japanese', 'latin'], w: [200, 400, 700, 900], v: 1, l: 'OFL-1.1' },
    { f: 'Roboto', c: 'sans-serif', s: ['latin'], w: [100, 400, 700], i: [400], l: 'Apache-2.0' },
    { f: 'Poppins', c: 'sans-serif', s: ['latin'], w: [400, 700], l: 'OFL-1.1' },
    { f: 'Broken Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Sliced Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Elsewhere Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Garbage Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Imposter Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Flaky Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Slow Font', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Slow Font Two', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
    { f: 'Slow Font Three', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' },
  ],
});

/** 本机已装的族（假引擎的扫描结果）。 */
const LOCAL = ['Roboto', 'Local Only Sans'];

interface FakeServer {
  url: string;
  requests: { url: string; userAgent: string | undefined }[];
  /** 慢文件：每块之间等多久（取消用）。 */
  slowMs: number;
  /** 前几次请求 Flaky Font 的文件回 503。 */
  flaky: number;
  close(): Promise<void>;
}

async function fakeFonts(): Promise<FakeServer> {
  const state = { requests: [] as FakeServer['requests'], slowMs: 50, flaky: 2 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    state.requests.push({ url: req.url!, userAgent: req.headers['user-agent'] });
    if (url.pathname === '/css2') {
      const [name, axes] = url.searchParams.get('family')!.split(':');
      const family = name!.replace(/\+/g, ' ');
      if (family === 'Broken Font') return void res.writeHead(404).end('no');
      // 样张（`text`）：一个只含这几个字的子集，地址带查询参数（同 Google Fonts 的 `/l/font?kit=…`）。
      const text = url.searchParams.get('text');
      if (text !== null) {
        const host = family === 'Elsewhere Font' ? 'https://evil.example' : 'https://fonts.gstatic.com';
        const kind = family === 'Noto Serif JP' ? 'woff2' : 'ttf';
        const src = `${host}/l/font?kit=${familySlug(family)}&kind=${kind}&text=${encodeURIComponent(text)}`;
        return void res
          .writeHead(200, { 'content-type': 'text/css' })
          .end(
            `@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  src: url(${src}) format('truetype');\n}\n`,
          );
      }
      const weights = axes!.replace(/^.*@/, '').split(';');
      const blocks = weights.map((w) => {
        const [italic, weight] = w.includes(',') ? w.split(',') : ['0', w];
        const slug = familySlug(family);
        const host = family === 'Elsewhere Font' ? 'https://evil.example' : 'https://fonts.gstatic.com';
        const range = family === 'Sliced Font' ? '  unicode-range: U+0000-00FF;\n' : '';
        return `@font-face {\n  font-family: '${family}';\n  font-style: ${italic === '1' ? 'italic' : 'normal'};\n  font-weight: ${weight};\n  src: url(${host}/s/${slug}/${weight}${italic === '1' ? 'i' : ''}.ttf?v=1) format('truetype');\n${range}}\n`;
      });
      const css = family === 'Sliced Font' ? blocks.join('') + blocks.join('') : blocks.join('');
      return void res.writeHead(200, { 'content-type': 'text/css' }).end(css);
    }
    if (url.pathname === '/l/font') {
      const slug = url.searchParams.get('kit')!;
      const family = CATALOGUE.families().find((f) => familySlug(f.family) === slug)!.family;
      if (family === 'Garbage Font') return void res.writeHead(200).end('<html>not a font</html>');
      const magic = url.searchParams.get('kind') === 'woff2' ? Buffer.from('wOF2') : Buffer.from([0, 1, 0, 0]);
      return void res.writeHead(200).end(Buffer.concat([magic, Buffer.from(`FONT:${family}\n${url.searchParams.get('text')}`)]));
    }
    const file = /^\/s\/([^/]+)\/(\d+)(i?)\.ttf$/.exec(url.pathname);
    if (!file) return void res.writeHead(404).end();
    const slug = file[1]!;
    const family = CATALOGUE.families().find((f) => familySlug(f.family) === slug)!.family;
    if (family === 'Flaky Font' && state.flaky-- > 0) return void res.writeHead(503).end();
    if (family === 'Garbage Font') return void res.writeHead(200).end('<html>not a font</html>');
    const name = family === 'Imposter Font' ? 'Comic Neue' : family;
    const body = Buffer.concat([Buffer.from(`FONT:${name}\n`), Buffer.alloc(4096, file[2]!.length)]);
    if (!family.startsWith('Slow Font')) return void res.writeHead(200, { 'content-length': body.length }).end(body);
    res.writeHead(200, { 'content-length': body.length * 50 });
    let sent = 0;
    const timer = setInterval(() => {
      if (sent++ >= 50 || res.destroyed) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(body);
    }, state.slowMs);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  }) as FakeServer;
}

/** 假引擎：本机字体是 `LOCAL`；本机没有时到下载缓存里挑（同字重优先，否则那个族的任何一个）。 */
function fakeEngine(cacheDir: string) {
  return {
    async fontFamilies() {
      return [...LOCAL];
    },
    async fontFaces(faces: FontFaceQuery[]): Promise<LocalFontFaces> {
      const result: LocalFontFaces = { faces: [], missing: [] };
      for (const face of faces) {
        const layout = { faceIndex: 0, fileSize: 1, size: 1, header: '', tables: [] };
        if (LOCAL.some((f) => f.toLowerCase() === face.family.toLowerCase())) {
          result.faces.push({ ...face, ...layout, source: 'local', path: `/System/Fonts/${face.family}.ttf` });
          continue;
        }
        const dir = path.join(cacheDir, familySlug(face.family));
        const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.ttf'));
        const exact = files.find((f) => f.includes(`-${face.weight}${face.italic ? 'i' : ''}-`));
        const file = exact ?? files[0];
        if (file) result.faces.push({ ...face, ...layout, source: 'downloaded', path: path.join(dir, file) });
        else result.missing.push({ ...face, reason: 'not-found' });
      }
      return result;
    },
    async inspectFont(file: string) {
      const bytes = await fs.readFile(file);
      // 样张前面有 TrueType 的文件头（`00 01 00 00`）。
      const head = bytes.subarray(bytes[0] === 0 && bytes[1] === 1 ? 4 : 0, 64).toString('utf8');
      if (!head.startsWith('FONT:')) throw new RpcError('invalid-request', '不是字体', { code: 'FONT_INVALID' });
      return [{ index: 0, families: [head.slice(5).split('\n')[0]!], postScriptName: 'Fake', weight: 400, italic: false }];
    },
  };
}

const videos = { retain: () => {}, release: () => {}, videoRevision: () => '1' } as unknown as JobVideos;
const router = { selectTranscribe: async () => ({}), transcriber: () => null, executors: () => [] } as unknown as TranscribeRouter;
const submitter = { kind: 'connection', id: 'conn_1' } as const;
/** 假服务给的字体文件的字节数。 */
const sizeOf = (family: string) => Buffer.byteLength(`FONT:${family}\n`) + 4096;

describe('按需下载的字体（FontService）', () => {
  let dir: string;
  let server: FakeServer;
  let jobs: JobManager;
  let fonts: FontService;
  let settings: FontSettings;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-font-service-'));
    server = await fakeFonts();
    jobs = new JobManager({
      paths: {
        jobsFile: path.join(dir, 'store', 'jobs.json'),
        stagingDir: path.join(dir, 'staging'),
        artifactsDir: path.join(dir, 'artifacts'),
        diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
      },
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router,
      videos,
    });
    await jobs.open();
    settings = { autoDownload: true, cssEndpoint: null, fileEndpoint: null, offlineStrict: false };
    const rewrite = (url: string) => url.replace(/^https:\/\/fonts\.(googleapis|gstatic)\.com/, server.url);
    fonts = new FontService({
      dir: path.join(dir, 'fonts'),
      jobs,
      videos: fakeEngine(path.join(dir, 'fonts', 'files')),
      log: silentLogger,
      settings: () => settings,
      catalogue: CATALOGUE,
      download: {
        fetch: (input, init) => fetch(rewrite(String(input)), init),
        retries: 3,
        backoffMs: () => 1,
      },
    });
  });

  afterEach(async () => {
    await jobs.shutdown();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const face = (family: string, weight = 400, italic = false): FontFaceQuery => ({ family, weight, italic });
  const resolve = (faces: FontFaceQuery[], download = true) => fonts.resolve(faces, { download, submitter });

  it('本机没有、目录里有的 face 自动下载：先记下载中，任务完成后从下载缓存解析；请求只带族名与字重', async () => {
    const first = await resolve([face('Lobster')]);
    expect(first.faces).toEqual([]);
    expect(first.missing).toEqual([{ ...face('Lobster'), reason: 'downloading', jobId: expect.stringMatching(/^job_/) }]);
    const jobId = first.missing[0]!.jobId!;
    expect(await jobs.settled(jobId)).toBe('completed');
    const record = jobs.inspect(jobId);
    expect(record).toMatchObject({ kind: 'fontDownload', providerId: 'google-fonts', modelId: 'Lobster', error: null });
    expect(record.result?.artifactId).toMatch(/^sha256:/);

    const again = await resolve([face('Lobster'), face('Lobster', 700)]);
    expect(again.missing).toEqual([]);
    expect(again.faces.map((f) => [f.weight, f.source])).toEqual([
      [400, 'downloaded'],
      [700, 'downloaded'],
    ]);
    // 族只有 400：要 700 时对到 400，已经有了，不再下载。
    expect(server.requests.map((r) => r.url)).toEqual(['/css2?family=Lobster:wght@400', '/s/lobster/400.ttf?v=1']);
    expect(server.requests.every((r) => r.userAgent === 'BaoCut')).toBe(true);

    const { faces, totalBytes } = await fonts.downloaded();
    expect(faces).toEqual([
      {
        family: 'Lobster',
        weight: 400,
        italic: false,
        licence: 'OFL-1.1',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        sizeBytes: sizeOf('Lobster'),
        downloadedAt: expect.any(String),
      },
    ]);
    expect(totalBytes).toBe(sizeOf('Lobster'));
    // 索引里不记地址；staging 里不留临时文件。
    expect(await fs.readFile(path.join(dir, 'fonts', 'index.json'), 'utf8')).not.toContain('gstatic');
    expect(await fs.readdir(path.join(dir, 'fonts', '.staging'))).toEqual([]);
  });

  it('同一个 face 同时要两次只下载一次；斜体与字重按目录对好再请求', async () => {
    const [a, b] = await Promise.all([resolve([face('Noto Serif JP', 600)]), resolve([face('Noto Serif JP', 700)])]);
    expect(a.missing[0]!.jobId).toBe(b.missing[0]!.jobId);
    await jobs.settled(a.missing[0]!.jobId!);
    expect(server.requests.map((r) => r.url)).toEqual(['/css2?family=Noto+Serif+JP:wght@700', '/s/noto-serif-jp/700.ttf?v=1']);
    // Roboto 是本机的；Poppins 随内核；不在目录里的族交给引擎（找不到就是 not-found）。都不下载。
    server.requests.length = 0;
    const others = await resolve([face('Roboto'), face('Poppins'), face('Nowhere Sans')]);
    expect(others.faces.map((f) => f.family)).toEqual(['Roboto']);
    expect(others.missing.map((m) => [m.family, m.reason])).toEqual([
      ['Poppins', 'not-found'],
      ['Nowhere Sans', 'not-found'],
    ]);
    expect(server.requests).toEqual([]);
  });

  it('下载失败的原因：HTTP 状态、分片、文件不在文件主机上、不是字体、族名对不上；坏文件不进缓存，最近失败过的不自动重试', async () => {
    const cases: [string, FontDownloadErrorCode, RegExp][] = [
      ['Broken Font', 'FONT_DOWNLOAD_SOURCE', /HTTP 404/],
      ['Sliced Font', 'FONT_DOWNLOAD_SOURCE', /分片/],
      ['Elsewhere Font', 'FONT_DOWNLOAD_SOURCE', /文件主机/],
      ['Garbage Font', 'FONT_DOWNLOAD_INTEGRITY', /不是能用的字体/],
      ['Imposter Font', 'FONT_DOWNLOAD_INTEGRITY', /族名对不上/],
    ];
    for (const [family, code, message] of cases) {
      const { missing } = await resolve([face(family)]);
      const jobId = missing[0]!.jobId!;
      expect(await jobs.settled(jobId), family).toBe('failed');
      const error = jobs.inspect(jobId).error!;
      expect(error.code, family).toBe(code);
      expect(error.message, family).toMatch(message);
      expect(error.message, family).not.toMatch(/https?:/);
      expect(error.details, family).toMatchObject({ family, remedy: FONT_DOWNLOAD_REMEDIES[code] });
      const status = (await fonts.catalogueList({ families: [family] })).families[0]!;
      expect(status, family).toMatchObject({ state: 'failed', error: { code, messageRef: { key: expect.stringMatching(/^rcFonts\./) } } });
    }
    expect(server.requests.some((r) => r.url.startsWith('/s/elsewhere'))).toBe(false);
    // 补救写给人看：指向设置页上的名字，不写设置的键（键名对人没有用，CLI 的帮助里另有）。
    for (const remedy of Object.values(FONT_DOWNLOAD_REMEDIES)) expect(remedy).not.toMatch(/fonts\.\w+/);
    expect(FONT_DOWNLOAD_REMEDIES.FONT_DOWNLOAD_NETWORK).toContain('「设置 › 字体」的「样式表地址」与「字体文件地址」');
    expect((await fonts.downloaded()).faces).toEqual([]);
    expect(await fs.readdir(path.join(dir, 'fonts', '.staging'))).toEqual([]);
    // 最近失败过：不自动重试，记 download-failed；手动下载就是重试。
    server.requests.length = 0;
    const later = await resolve([face('Broken Font')]);
    expect(later.missing).toEqual([{ ...face('Broken Font'), reason: 'download-failed', code: 'FONT_DOWNLOAD_SOURCE' }]);
    expect(server.requests).toEqual([]);
    const retry = await fonts.download({ family: 'broken font' }, submitter);
    expect(retry).toMatchObject({ family: 'Broken Font', faces: [{ weight: 400, italic: false }], status: { state: 'downloading' } });
    await jobs.settled(retry.jobId!);
    expect(server.requests.map((r) => r.url)).toEqual(['/css2?family=Broken+Font:wght@400']);
  });

  it('连不上与 5xx 按退避重试；不下载的情况：自动下载关着、严格离线、不在目录里、本机已有', async () => {
    const { missing } = await resolve([face('Flaky Font')]);
    expect(await jobs.settled(missing[0]!.jobId!)).toBe('completed');
    expect(server.requests.filter((r) => r.url.startsWith('/s/flaky')).length).toBe(3);

    settings.autoDownload = false;
    expect((await resolve([face('Lobster')])).missing).toEqual([{ ...face('Lobster'), reason: 'downloadable' }]);
    settings.autoDownload = true;
    expect((await resolve([face('Lobster')], false)).missing).toEqual([{ ...face('Lobster'), reason: 'downloadable' }]);
    settings.offlineStrict = true;
    expect((await resolve([face('Lobster')])).missing).toEqual([{ ...face('Lobster'), reason: 'downloadable' }]);
    await expect(fonts.download({ family: 'Lobster' }, submitter)).rejects.toMatchObject({ details: { code: 'OFFLINE_STRICT' } });
    settings.offlineStrict = false;
    await expect(fonts.download({ family: 'Comic Sans MS' }, submitter)).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'FONT_NOT_IN_CATALOGUE' },
    });
    await expect(fonts.download({ family: 'Roboto' }, submitter)).rejects.toMatchObject({ details: { code: 'FONT_NOT_DOWNLOADABLE' } });
    await expect(fonts.download({ family: 'Poppins' }, submitter)).rejects.toMatchObject({ details: { code: 'FONT_NOT_DOWNLOADABLE' } });
    expect(server.requests.some((r) => r.url.includes('Lobster'))).toBe(false);
  });

  it('取消下载：任务记为取消，临时文件删除，选字列表显示取消；同一个命令重发返回原来的任务', async () => {
    const started = await fonts.download({ family: 'Slow Font', commandId: 'cmd_slow' }, submitter);
    const jobId = started.jobId!;
    expect((await fonts.download({ family: 'Slow Font', commandId: 'cmd_slow' }, submitter)).jobId).toBe(jobId);
    // 等到真的在下载（有字节进来）再取消。
    for (let i = 0; i < 100 && !((await fonts.catalogueList({ families: ['Slow Font'] })).families[0]!.job?.doneBytes ?? 0); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const downloading = (await fonts.catalogueList({ families: ['Slow Font'] })).families[0]!;
    expect(downloading).toMatchObject({ state: 'downloading', job: { jobId, totalBytes: sizeOf('Slow Font') * 50 } });
    expect(downloading.job!.doneBytes).toBeGreaterThan(0);
    await jobs.cancel(jobId);
    expect(await jobs.settled(jobId)).toBe('cancelled');
    for (let i = 0; i < 50 && (await fs.readdir(path.join(dir, 'fonts', '.staging'))).length > 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(await fs.readdir(path.join(dir, 'fonts', '.staging'))).toEqual([]);
    expect((await fonts.catalogueList({ families: ['Slow Font'] })).families[0]).toMatchObject({
      state: 'failed',
      error: { code: 'CANCELLED', messageRef: { key: 'rcFonts.cancelled' } },
      job: null,
    });
    expect((await fonts.downloaded()).faces).toEqual([]);
  });

  it('取消不算失败：取消的下载、取消导出停下的下载，下次要用时照样自动下载；真的失败了才十分钟内不自动重试', async () => {
    const settledFamily = async (family: string) => {
      for (let i = 0; i < 100 && (await fonts.catalogueList({ families: [family] })).families[0]!.state === 'downloading'; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return (await fonts.catalogueList({ families: [family] })).families[0]!;
    };

    // 取消下载任务（选字、字体条的跳过）：选字列表记「已取消」，下次清点或预览要它时重新下载。
    const cancelled = (await fonts.download({ family: 'Slow Font' }, submitter)).jobId!;
    for (let i = 0; i < 100 && !((await fonts.catalogueList({ families: ['Slow Font'] })).families[0]!.job?.doneBytes ?? 0); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await jobs.cancel(cancelled);
    expect(await jobs.settled(cancelled)).toBe('cancelled');
    expect(await settledFamily('Slow Font')).toMatchObject({ state: 'failed', error: { code: 'CANCELLED' } });
    server.slowMs = 5;
    const census = { fallback: 'Noto Sans SC', faces: [{ family: 'Slow Font', weight: 400, italic: false, bundled: false }] };
    const reopened = await fonts.usage(census, { download: true, submitter });
    expect(reopened.started).toEqual(['Slow Font']);
    const again = reopened.families[0]!.status.job!.jobId;
    expect(again).not.toBe(cancelled);
    expect(await jobs.settled(again)).toBe('completed');

    // 取消导出：导出自己开始的下载停下，下一次预览要这个 face 时自动下载。
    server.slowMs = 50;
    const controller = new AbortController();
    const exporting = fonts.ensureForExport([face('Slow Font Two')], 'job_export_cancelled', controller.signal, () => {});
    setTimeout(() => controller.abort(new Error('导出取消了')), 100);
    await expect(exporting).rejects.toThrow('导出取消了');
    expect(await settledFamily('Slow Font Two')).toMatchObject({ state: 'failed', error: { code: 'CANCELLED' } });
    server.slowMs = 5;
    const { missing } = await resolve([face('Slow Font Two')]);
    expect(missing).toEqual([{ ...face('Slow Font Two'), reason: 'downloading', jobId: expect.stringMatching(/^job_/) }]);
    expect(await jobs.settled(missing[0]!.jobId!)).toBe('completed');

    // 真的失败：十分钟内不自动重试，答「下载失败」，不提交新任务。
    const failed = (await resolve([face('Broken Font')])).missing[0]!.jobId!;
    expect(await jobs.settled(failed)).toBe('failed');
    const count = jobs.list().length;
    expect((await resolve([face('Broken Font')])).missing).toEqual([
      { ...face('Broken Font'), reason: 'download-failed', code: 'FONT_DOWNLOAD_SOURCE' },
    ]);
    expect(jobs.list()).toHaveLength(count);
  });

  it('同时下载三个族：两个马上开始，第三个从第一条记录起就是排在上限后面的 queued，前面的下完才开始', async () => {
    server.slowMs = 5;
    const seen = new Map<string, { state: string; wait: string | null }[]>();
    const stop = jobs.onChange((job) => {
      if (job.kind !== 'fontDownload') return;
      const list = seen.get(job.jobId) ?? [];
      list.push({ state: job.state, wait: job.wait?.reason ?? null });
      seen.set(job.jobId, list);
    });
    try {
      const families = ['Slow Font', 'Slow Font Two', 'Slow Font Three'];
      const ids: string[] = [];
      for (const family of families) ids.push((await fonts.download({ family }, submitter)).jobId!);
      for (const id of ids) expect(await jobs.settled(id)).toBe('completed');
      const [a, b, c] = ids.map((id) => seen.get(id)!);
      // 马上开始的：第一条是不带 wait 的 queued，接着 running，从没在等。
      for (const records of [a!, b!]) {
        expect(records[0]).toEqual({ state: 'queued', wait: null });
        expect(records[1]).toEqual({ state: 'running', wait: null });
        expect(records.some((r) => r.wait !== null)).toBe(false);
      }
      // 要等的：第一条就带着 wait（界面头一眼就是「等待中」），等到前面的有一个结束才 running。
      expect(c![0]).toEqual({ state: 'queued', wait: 'concurrency' });
      const running = c!.findIndex((r) => r.state === 'running');
      expect(running).toBeGreaterThan(0);
      expect(c!.slice(0, running).every((r) => r.state === 'queued')).toBe(true);
      expect(c!.at(-1)).toEqual({ state: 'completed', wait: null });
      const firstEnd = Math.min(...[ids[0]!, ids[1]!].map((id) => Date.parse(jobs.inspect(id).endedAt!)));
      expect(Date.parse(jobs.inspect(ids[2]!).startedAt!)).toBeGreaterThanOrEqual(firstEnd);
    } finally {
      stop();
    }
  });

  it('选字列表：随内核在前，已下载其次，再按目录，本机独有的最后；按名字、分类、文字与状态筛，分页', async () => {
    await jobs.settled((await fonts.download({ family: 'Lobster' }, submitter)).jobId!);
    const all = await fonts.catalogueList({ limit: 500 });
    const names = all.families.map((f) => f.family);
    expect(names.indexOf('Poppins')).toBeLessThan(names.indexOf('Lobster'));
    expect(names.indexOf('Lobster')).toBeLessThan(names.indexOf('Noto Serif JP'));
    expect(names.at(-1)).toBe('Local Only Sans');
    expect(all.catalogueDate).toBe('2026-10-04');
    const byName = Object.fromEntries(all.families.map((f) => [f.family, f]));
    expect(byName['Poppins']).toMatchObject({ state: 'built-in', source: 'built-in' });
    expect(byName['Roboto']).toMatchObject({ state: 'installed', source: 'local', licence: 'Apache-2.0', italics: [400] });
    expect(byName['Local Only Sans']).toMatchObject({ state: 'installed', source: 'local', licence: null, category: null });
    expect(byName['Lobster']).toMatchObject({
      state: 'downloaded',
      source: 'google-fonts',
      licence: 'OFL-1.1',
      scripts: ['latin', 'cyrillic', 'vietnamese'],
      downloaded: [{ weight: 400, italic: false, sizeBytes: sizeOf('Lobster') }],
    });
    expect(byName['Noto Serif JP']).toMatchObject({ state: 'downloadable', variable: true, scripts: ['japanese', 'latin'] });
    expect((await fonts.catalogueList({ script: 'japanese' })).families.map((f) => f.family)).toEqual(['Noto Serif JP']);
    expect((await fonts.catalogueList({ category: 'serif' })).families.map((f) => f.family)).toEqual(['Noto Serif JP']);
    expect((await fonts.catalogueList({ query: 'LOB' })).families.map((f) => f.family)).toEqual(['Lobster']);
    expect((await fonts.catalogueList({ states: ['downloaded', 'installed'] })).families.map((f) => f.family)).toEqual([
      'Lobster',
      'Roboto',
      'Local Only Sans',
    ]);
    const page = await fonts.catalogueList({ offset: 2, limit: 3 });
    expect(page.total).toBe(all.total);
    expect(page.families.map((f) => f.family)).toEqual(names.slice(2, 5));
  });

  it('删除与清空：还没结束的导出用着的不删（FONT_IN_USE），任务结束后可以删；清空留下用着的', async () => {
    await jobs.settled((await fonts.download({ family: 'Lobster' }, submitter)).jobId!);
    await jobs.settled((await fonts.download({ family: 'Noto Serif JP', faces: [{ weight: 400, italic: false }] }, submitter)).jobId!);
    const [lobster] = (await fonts.resolve([face('Lobster')], { download: false, submitter })).faces;
    // 一个还在跑的「导出」钉住 Lobster 的文件。
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const { jobId } = jobs.submitTask(
      {
        kind: 'export',
        spec: { task: 'export', snapshotArtifactId: `sha256:${'a'.repeat(64)}` },
        videoId: null,
        contentHash: `sha256:${'a'.repeat(64)}`,
        inputHash: `sha256:${'b'.repeat(64)}`,
        providerId: 'local',
        modelId: 'export',
        queue: { key: 'export', concurrency: 1 },
        run: async () => (await gate, { documentId: null, artifactId: `sha256:${'c'.repeat(64)}` }),
      },
      submitter,
    );
    fonts.pin(jobId, { files: [lobster!.path] });
    expect((await fonts.downloaded()).inUse).toEqual(['Lobster']);
    await expect(fonts.remove({ family: 'lobster' })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'FONT_IN_USE', jobIds: [jobId] },
    });
    const cleared = await fonts.clear();
    expect(cleared.removed.map((f) => f.family)).toEqual(['Noto Serif JP']);
    expect(cleared.kept.map((f) => f.family)).toEqual(['Lobster']);
    expect(cleared.freedBytes).toBe(sizeOf('Noto Serif JP'));
    // 客户端一收到终态就来取已下载列表：这时任务还没落盘算完（`settled`），也已经不算在用。
    let atEnd: Promise<string[]> | null = null;
    const stop = jobs.onChange((job) => {
      if (job.jobId === jobId && job.state === 'completed') atEnd ??= fonts.downloaded().then((d) => d.inUse);
    });
    finish();
    await jobs.settled(jobId);
    stop();
    expect(await atEnd).toEqual([]);
    const removed = await fonts.remove({ family: 'Lobster' });
    expect(removed).toMatchObject({ removed: [{ family: 'Lobster', weight: 400 }], freedBytes: sizeOf('Lobster'), kept: [] });
    expect((await fonts.downloaded()).totalBytes).toBe(0);
    await expect(fs.readdir(path.join(dir, 'fonts', 'files', 'lobster'))).rejects.toThrow();
  });

  it('导出：冻结时分出要下载的 face，任务里下载（进度按字节、失败给原因、取消就停）', async () => {
    const plans = await fonts.planExport([face('Lobster'), face('Roboto'), face('Nowhere Sans')]);
    expect([...plans.values()]).toEqual([{ kind: 'download' }, { kind: 'engine' }, { kind: 'engine' }]);
    settings.autoDownload = false;
    expect([...(await fonts.planExport([face('Lobster')])).values()]).toEqual([
      { kind: 'skip', reason: '自动下载字体已关闭（「设置 › 字体」里的「自动下载字体」）' },
    ]);
    settings.autoDownload = true;

    const progress: [number, number | null][] = [];
    const outcomes = await fonts.ensureForExport(
      [face('Lobster'), face('Broken Font')],
      'job_export',
      new AbortController().signal,
      (d, t) => progress.push([d, t]),
    );
    expect(outcomes.get('Lobster\u0000400\u00000')).toBeNull();
    expect(outcomes.get('Broken Font\u0000400\u00000')).toMatch(/下载失败：.*HTTP 404/);
    // 失败的那个不算进进度：总数照样知道（界面念百分比）。
    expect(progress.at(-1)).toEqual([sizeOf('Lobster'), sizeOf('Lobster')]);
    expect((await fonts.downloaded()).faces.map((f) => f.family)).toEqual(['Lobster']);

    const controller = new AbortController();
    const pending = fonts.ensureForExport([face('Slow Font')], 'job_export_2', controller.signal, () => {});
    setTimeout(() => controller.abort(new Error('导出取消了')), 100);
    await expect(pending).rejects.toThrow('导出取消了');
    expect((await fonts.downloaded()).faces.map((f) => f.family)).toEqual(['Lobster']);
  });
  it('取消导出只停它自己开始的下载：别处（选字、打开视频）开始的同一个 face 照样下完', async () => {
    server.slowMs = 10;
    const started = await fonts.download({ family: 'Slow Font' }, submitter);
    const controller = new AbortController();
    const pending = fonts.ensureForExport([face('Slow Font')], 'job_export_3', controller.signal, () => {});
    setTimeout(() => controller.abort(new Error('导出取消了')), 30);
    await expect(pending).rejects.toThrow('导出取消了');
    expect(await jobs.settled(started.jobId!)).toBe('completed');
    expect((await fonts.downloaded()).faces.map((f) => f.family)).toEqual(['Slow Font']);
  });
  it('样张：只带族名里的字（text 参数），按文件头认格式，存进缓存下次不再取；严格离线、不在目录里不取；文件不在文件主机上就报', async () => {
    const lobster = await fonts.sample({ family: 'lobster' });
    expect(lobster).toMatchObject({ family: 'Lobster', text: 'Lobster', format: 'truetype' });
    expect(Buffer.from(lobster.data!, 'base64').subarray(4).toString('utf8')).toBe('FONT:Lobster\nLobster');
    expect(server.requests.map((r) => r.url)).toEqual([
      '/css2?family=Lobster:wght@400&text=Lobster',
      '/l/font?kit=lobster&kind=ttf&text=Lobster',
    ]);
    expect(server.requests.every((r) => r.userAgent === 'BaoCut')).toBe(true);
    // 族名去掉空白与重复的字；WOFF2 只认文件头（引擎读不了压缩的）。
    const jp = await fonts.sample({ family: 'Noto Serif JP' });
    expect(jp).toMatchObject({ text: 'NotSerifJP', format: 'woff2' });
    expect(server.requests[2]!.url).toBe('/css2?family=Noto+Serif+JP:wght@400&text=NotSerifJP');

    // 缓存：再要不联网；严格离线时缓存里有的照给，没有的不取。
    server.requests.length = 0;
    expect(await fonts.sample({ family: 'Lobster' })).toEqual(lobster);
    settings.offlineStrict = true;
    expect(await fonts.sample({ family: 'Lobster' })).toEqual(lobster);
    expect(await fonts.sample({ family: 'Poppins' })).toMatchObject({ data: null, reason: 'offline-strict' });
    settings.offlineStrict = false;
    expect(await fonts.sample({ family: 'Local Only Sans' })).toMatchObject({ data: null, reason: 'not-in-catalogue' });
    expect(server.requests).toEqual([]);
    const files = await fs.readdir(path.join(dir, 'fonts', 'samples'));
    expect(files.sort()).toEqual([
      expect.stringMatching(/^lobster-[0-9a-f]{16}\.truetype$/),
      expect.stringMatching(/^noto-serif-jp-[0-9a-f]{16}\.woff2$/),
    ]);

    await expect(fonts.sample({ family: 'Elsewhere Font' })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'FONT_DOWNLOAD_SOURCE' },
    });
    await expect(fonts.sample({ family: 'Garbage Font' })).rejects.toMatchObject({ details: { code: 'FONT_DOWNLOAD_INTEGRITY' } });
    await expect(fonts.sample({ family: 'Broken Font' })).rejects.toMatchObject({ details: { code: 'FONT_DOWNLOAD_SOURCE' } });
    // 样张不算下载的字体：不进索引、不占「已下载」。
    expect((await fonts.downloaded()).faces).toEqual([]);
    expect(await fs.readdir(path.join(dir, 'fonts', 'samples'))).toHaveLength(2);
  });

  it('视频用到的字体：按族归好，带状态与回退族；download 时按自动下载的规则开始下载，最近失败过的不自动重试', async () => {
    const census = {
      fallback: 'Noto Sans SC',
      faces: [
        { family: 'Lobster', weight: 700, italic: false, bundled: false },
        { family: 'Lobster', weight: 400, italic: false, bundled: false },
        { family: 'Poppins', weight: 400, italic: false, bundled: true },
        { family: 'Roboto', weight: 400, italic: true, bundled: false },
        { family: 'Nowhere Sans', weight: 400, italic: false, bundled: false },
        { family: 'Broken Font', weight: 400, italic: false, bundled: false },
      ],
    };
    const looked = await fonts.usage(census, { download: false, submitter });
    expect(looked.started).toEqual([]);
    expect(looked.fallback).toBe('Noto Sans SC');
    expect(looked.families.map((f) => [f.family, f.status.state, f.fallback])).toEqual([
      ['Broken Font', 'downloadable', 'Noto Sans SC'],
      ['Lobster', 'downloadable', 'Noto Sans SC'],
      ['Nowhere Sans', 'unavailable', 'Noto Sans SC'],
      ['Poppins', 'built-in', null],
      ['Roboto', 'installed', null],
    ]);
    expect(looked.families.find((f) => f.family === 'Lobster')!.faces).toEqual([
      { weight: 400, italic: false },
      { weight: 700, italic: false },
    ]);
    expect(server.requests).toEqual([]);

    // 自动下载关着：download 也不下载。
    settings.autoDownload = false;
    expect((await fonts.usage(census, { download: true, submitter })).started).toEqual([]);
    settings.autoDownload = true;

    const opened = await fonts.usage(census, { download: true, submitter });
    expect(opened.started.sort()).toEqual(['Broken Font', 'Lobster']);
    const lobster = opened.families.find((f) => f.family === 'Lobster')!;
    expect(lobster.status).toMatchObject({ state: 'downloading', job: { jobId: expect.stringMatching(/^job_/) } });
    expect(lobster.fallback).toBe('Noto Sans SC');
    await jobs.settled(lobster.status.job!.jobId);
    await jobs.settled(opened.families.find((f) => f.family === 'Broken Font')!.status.job!.jobId);

    // 再打开：下载好的不用回退；刚失败的不自动重试（十分钟内），状态是失败与原因。
    server.requests.length = 0;
    const again = await fonts.usage(census, { download: true, submitter });
    expect(again.started).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(again.families.map((f) => [f.family, f.status.state, f.fallback])).toEqual([
      ['Broken Font', 'failed', 'Noto Sans SC'],
      ['Lobster', 'downloaded', null],
      ['Nowhere Sans', 'unavailable', 'Noto Sans SC'],
      ['Poppins', 'built-in', null],
      ['Roboto', 'installed', null],
    ]);
    expect(again.families[0]!.status.error).toMatchObject({ code: 'FONT_DOWNLOAD_SOURCE' });
  });
});
