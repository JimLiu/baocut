import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OnlineAssets, resolveOnlineAssetsUrl, DEFAULT_ONLINE_ASSETS_URL, type OnlineAsset } from './online-assets.ts';

const body = Buffer.from('{"v":"5.7.0","fr":30}');
const asset: OnlineAsset = { path: 'stickers/anim/a.json', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };

describe('线上素材', () => {
  let dir: string;
  let server: http.Server;
  let baseUrl: string;
  let served: Record<string, Buffer>;
  let requests: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-online-assets-'));
    served = { '/stickers/anim/a.json': body };
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.url!);
      const bytes = served[req.url!];
      if (!bytes) return res.writeHead(404).end();
      res.writeHead(200, { 'content-length': bytes.length }).end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const assets = () => new OnlineAssets({ baseUrl, cacheDir: dir, download: { retries: 0, backoffMs: () => 0 } });

  it('基址取环境变量，去掉末尾的斜杠；没有时用默认的 CDN', () => {
    expect(resolveOnlineAssetsUrl({ BAOCUT_ASSETS_URL: 'http://127.0.0.1:9/x/' })).toBe('http://127.0.0.1:9/x');
    expect(resolveOnlineAssetsUrl({})).toBe(DEFAULT_ONLINE_ASSETS_URL);
  });

  it('第一次下载进缓存；之后（包括新进程、离线）直接用缓存，同时要几次只下一次', async () => {
    const online = assets();
    const [file, again] = await Promise.all([online.ensure(asset), online.ensure(asset)]);
    expect(file).toBe(path.join(dir, 'stickers', 'anim', 'a.json'));
    expect(again).toBe(file);
    expect(await fs.readFile(file)).toEqual(body);
    expect(requests).toEqual(['/stickers/anim/a.json']);
    await online.ensure(asset);
    served = {};
    expect(await assets().ensure(asset)).toBe(file);
    expect(requests).toHaveLength(1);
  });

  it('缓存里的文件对不上就重下；下来的对不上清单、下不来时报 ONLINE_ASSET_UNAVAILABLE', async () => {
    const file = path.join(dir, 'stickers', 'anim', 'a.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(body.length, 0x20));
    expect(await assets().ensure(asset)).toBe(file);
    expect(await fs.readFile(file)).toEqual(body);

    await expect(assets().ensure({ ...asset, path: 'stickers/anim/a.json', sha256: '0'.repeat(64) })).rejects.toMatchObject({
      details: { code: 'ONLINE_ASSET_UNAVAILABLE', path: 'stickers/anim/a.json' },
    });
    await expect(assets().ensure({ ...asset, path: 'stickers/anim/gone.json' })).rejects.toMatchObject({
      details: { code: 'ONLINE_ASSET_UNAVAILABLE' },
    });
    await expect(fs.stat(path.join(dir, 'stickers', 'anim', 'gone.json'))).rejects.toThrow();
  });

  it('路径只能是相对的普通段', () => {
    for (const bad of ['../x.json', '/x.json', 'a//b.json', 'a/./b.json', 'a\\b.json']) {
      expect(() => assets().ensure({ ...asset, path: bad }), bad).toThrow();
    }
  });
});
