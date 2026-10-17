import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { COMPOSITION_BRIDGE_CHANNEL, RpcError } from '@baocut/protocol';
import { MediaRegistry, bundlePathOf } from './media.ts';

/**
 * 代码包目录的地址 `/bundle/<句柄>/<包内路径>`（动效视频设计 §4.1、架构设计 §4.5）：入口页面注入脚本、包内文件按类型给出并带包自己的
 * CSP，目录外、点文件与伪造的句柄一律 404。只起一个回环 HTTP 服务，不碰浏览器。
 */

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .request(url, { method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject)
      .end();
  });
}

describe('代码包目录地址', () => {
  let root: string;
  let server: http.Server;
  let origin: string;
  const registry = new MediaRegistry({ log: silentLogger, originAllowed: () => true });
  const inject = `<script>/* ${COMPOSITION_BRIDGE_CHANNEL} */</script>`;

  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-bundle-route-')));
    await fs.mkdir(path.join(root, 'assets', 'bundle', 'lib'), { recursive: true });
    await fs.writeFile(path.join(root, 'assets', 'bundle', 'index.html'), '<!doctype html>\n<html lang="en">\n<head><title>t</title></head><body></body></html>');
    await fs.writeFile(path.join(root, 'assets', 'bundle', 'lib', 'main.js'), 'console.log(1)');
    await fs.writeFile(path.join(root, 'assets', 'bundle', 'scene.glb'), Buffer.alloc(16, 7));
    await fs.writeFile(path.join(root, 'assets', 'bundle', '.hidden'), 'x');
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
    server = http.createServer((request, response) => {
      if (!registry.handle(request, response)) response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    origin = `http://127.0.0.1:${port}`;
    registry.setBaseUrl(origin);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it('入口页面注入脚本并带包自己的 CSP，包内文件按类型给出', async () => {
    const handle = await registry.issueBundle(root, 'assets/bundle', { entry: 'index.html', inject });
    expect(handle.url).toMatch(new RegExp(`^${origin}/bundle/[A-Za-z0-9_-]+/$`));
    expect(handle.entry).toBe('index.html');

    const page = await get(handle.url + handle.entry);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['content-length']).toBe(String(Buffer.byteLength(page.body)));
    expect(page.body.startsWith('<!doctype html>\n<html lang="en">\n<head>' + inject + '<title>')).toBe(true);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['x-frame-options']).toBeUndefined();
    expect(page.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const csp = page.headers['content-security-policy'] as string;
    expect(csp).toContain(`script-src 'unsafe-inline' 'wasm-unsafe-eval' ${handle.url}`);
    expect(csp).toContain(`connect-src ${handle.url}`);
    expect(csp).toContain("child-src 'none'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain("'self'");

    const head = await get(handle.url + handle.entry, {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(page.headers['content-length']);
    expect(head.body).toBe('');

    const script = await get(handle.url + 'lib/main.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.body).toBe('console.log(1)');
    expect(script.headers['content-security-policy']).toBe(csp);

    const model = await get(handle.url + 'scene.glb', { Range: 'bytes=4-7' });
    expect(model.status).toBe(206);
    expect(model.headers['content-type']).toBe('model/gltf-binary');
    expect(model.headers['content-range']).toBe('bytes 4-7/16');
    expect(model.body).toHaveLength(4);

    expect((await get(handle.url + 'lib/main.js', {}, 'POST')).status).toBe(405);
  });

  it('目录外、点文件、`..` 与伪造或过期的句柄都是 404；目录要在根之内', async () => {
    const handle = await registry.issueBundle(root, 'assets/bundle', { entry: 'index.html', inject });
    for (const target of ['.hidden', 'lib/../../outside.txt', '%2e%2e/outside.txt', 'lib/', 'lib/..%2fmain.js', 'missing.js']) {
      expect((await get(handle.url + target)).status, target).toBe(404);
    }
    expect((await get(`${origin}/bundle/${'A'.repeat(32)}/index.html`)).status).toBe(404);
    expect((await get(`${origin}/bundle/`)).status).toBe(404);

    await expect(registry.issueBundle(path.join(root, 'assets'), '..', { entry: 'outside.txt', inject })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(registry.issueBundle(root, 'assets/bundle/index.html', { entry: 'index.html', inject })).rejects.toMatchObject({ code: 'not-found' });
    await expect(registry.issueBundle(root, 'assets/bundle', { entry: '../outside.txt', inject })).rejects.toMatchObject({ code: 'not-found' });
    await expect(registry.issueBundle(root, 'assets/bundle', { entry: 'nope.html', inject })).rejects.toBeInstanceOf(RpcError);

    const short = new MediaRegistry({ log: silentLogger, originAllowed: () => true, ttlMs: 1 });
    short.setBaseUrl(origin);
    const expired = await short.issueBundle(root, 'assets/bundle', { entry: 'index.html', inject });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const swap = http.createServer((request, response) => {
      if (!short.handle(request, response)) response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => swap.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = swap.address() as { port: number };
      const url = new URL(expired.url);
      expect((await get(`http://127.0.0.1:${port}${url.pathname}index.html`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => swap.close(() => resolve()));
    }
  });

  it('包内路径只认普通的 `/` 分隔相对路径', () => {
    expect(bundlePathOf('index.html')).toBe('index.html');
    expect(bundlePathOf('lib/a%20b.js')).toBe('lib/a b.js');
    for (const bad of ['', '/', 'a//b', './a', 'a/../b', '.git/config', 'a%2fb', 'a\\b', '%zz']) expect(bundlePathOf(bad), bad).toBeNull();
  });
});
