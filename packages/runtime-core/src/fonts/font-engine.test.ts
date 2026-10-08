import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { JobManager, type JobVideos, type TranscribeRouter } from '@baocut/jobs';
import { ModelCatalog } from '@baocut/models';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { VideoService } from '../videos/video-service.ts';
import { BUNDLED_FONT_FAMILIES } from './bundled-fonts.ts';
import { FontCatalogue } from './font-catalogue.ts';
import { FontService } from './font-service.ts';

/**
 * 按需下载的字体与真实引擎（架构设计 §9.1）：随内核发布的族名与文件对拍；下载的文件由引擎按渲染用的同一套解析核对，
 * 核对过的进缓存后由引擎在本机字体之后挑到。字体服务是本机的假服务，给的是 render-raster 的测试字体 ColrProbe。
 * 缺 engine-host 时跳过。
 */

const engine = resolveEngineHostCommand();
if (!engine) console.warn('跳过字体与引擎的测试：没有构建 engine-host（npm run build:engine）');

const repo = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
const BUNDLED_DIR = repo('crates/render-raster/assets/fonts');
const PROBE = repo('crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf');

describe.skipIf(!engine)('字体与真实引擎', () => {
  let dir: string;
  let services: VideoService[];

  const videoService = (fontDirs: string, fontCacheDir?: string) => {
    const service = new VideoService({
      log: silentLogger,
      resolveCommand: () => engine,
      env: async () => ({ ...process.env, BAOCUT_HOME: path.join(dir, 'home'), BAOCUT_FONT_DIRS: fontDirs }),
      ...(fontCacheDir ? { fontCacheDir } : {}),
    });
    services.push(service);
    return service;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-font-engine-'));
    services = [];
  });

  afterEach(async () => {
    for (const service of services) await service.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('随内核发布的族名与字体文件里的一致', async () => {
    const families = await videoService(BUNDLED_DIR).fontFamilies();
    expect(new Set(families.map((f) => f.toLowerCase()))).toEqual(new Set(BUNDLED_FONT_FAMILIES.map((f) => f.toLowerCase())));
  });

  it('下载的文件经引擎核对：是字体、族名对得上才进缓存；之后引擎从缓存里挑到它（本机没有这个族）', async () => {
    const probe = await fs.readFile(PROBE);
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://127.0.0.1');
      if (url.pathname === '/css2') {
        const family = url.searchParams.get('family')!.split(':')[0]!.replace(/\+/g, ' ');
        const slug = family.toLowerCase().replace(/ /g, '');
        return void res
          .writeHead(200)
          .end(
            `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/${slug}/a.ttf) format('truetype'); }`,
          );
      }
      if (url.pathname === '/s/garbagefont/a.ttf') return void res.writeHead(200).end(Buffer.alloc(2048, 7));
      res.writeHead(200, { 'content-length': probe.length }).end(probe);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fontsDir = path.join(dir, 'fonts');
    const emptyFonts = await fs.mkdtemp(path.join(dir, 'system-'));
    const videos = videoService(emptyFonts, path.join(fontsDir, 'files'));
    const jobs = new JobManager({
      paths: {
        jobsFile: path.join(dir, 'store', 'jobs.json'),
        stagingDir: path.join(dir, 'staging'),
        artifactsDir: path.join(dir, 'artifacts'),
        diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
      },
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router: { selectTranscribe: async () => ({}), transcriber: () => null, executors: () => [] } as unknown as TranscribeRouter,
      videos: {} as JobVideos,
    });
    await jobs.open();
    try {
      const fonts = new FontService({
        dir: fontsDir,
        jobs,
        videos,
        log: silentLogger,
        settings: () => ({ autoDownload: true, cssEndpoint: null, fileEndpoint: null, offlineStrict: false }),
        catalogue: FontCatalogue.parse({
          schema: 'baocut.google-fonts-catalogue/1',
          families: ['ColrProbe', 'Lobster', 'Garbage Font'].map((f) => ({ f, c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' })),
        }),
        download: {
          fetch: (input, init) => fetch(String(input).replace(/^https:\/\/fonts\.(googleapis|gstatic)\.com/, origin), init),
          retries: 0,
        },
      });
      const submitter = { kind: 'connection', id: 'conn_1' } as const;
      const face = { family: 'ColrProbe', weight: 400, italic: false };
      expect((await videos.fontFaces([face])).missing).toEqual([{ ...face, reason: 'not-found' }]);
      const download = await fonts.download({ family: 'ColrProbe' }, submitter);
      expect(await jobs.settled(download.jobId!)).toBe('completed');
      const resolved = await fonts.resolve([face], { download: false, submitter });
      expect(resolved.missing).toEqual([]);
      expect(resolved.faces[0]).toMatchObject({ ...face, source: 'downloaded', faceIndex: 0, fileSize: probe.length });
      expect(path.dirname(path.dirname(resolved.faces[0]!.path))).toBe(path.join(fontsDir, 'files'));
      expect(await fs.readFile(resolved.faces[0]!.path)).toEqual(probe);

      // 文件是字体但族名不对（给 Lobster 的是 ColrProbe）；不是字体。都不进缓存。
      for (const [family, message] of [
        ['Lobster', /族名对不上/],
        ['Garbage Font', /不是能用的字体/],
      ] as const) {
        const { jobId } = await fonts.download({ family }, submitter);
        expect(await jobs.settled(jobId!), family).toBe('failed');
        expect(jobs.inspect(jobId!).error, family).toMatchObject({
          code: 'FONT_DOWNLOAD_INTEGRITY',
          message: expect.stringMatching(message),
        });
      }
      expect((await fonts.downloaded()).faces.map((f) => f.family)).toEqual(['ColrProbe']);
      // 引擎的检查只认绝对路径、读得出来的字体。
      await expect(videos.inspectFont(path.join(dir, 'nothing.ttf'))).rejects.toMatchObject({ details: { code: 'FONT_INVALID' } });
    } finally {
      await jobs.shutdown();
      await new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
    }
  });
});
