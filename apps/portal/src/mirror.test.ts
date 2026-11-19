import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  KEEP_RELEASES,
  mirrorReleases,
  mirrorReleasesFrom,
  parseMirrorPath,
  parseRange,
  serveMirror,
  type MirrorBucket,
  type MirrorDeps,
  type MirrorObject,
} from './mirror.ts';
import worker from './worker.ts';

/** 内存里的 R2 桶：只实现镜像用到的几个调用。put 按 sha256 校验，对不上就不存，与 R2 一样。 */
function memoryBucket(initial: Record<string, Uint8Array<ArrayBuffer>> = {}) {
  const store = new Map<string, { bytes: Uint8Array<ArrayBuffer>; uploaded: Date; contentType?: string }>();
  for (const [key, bytes] of Object.entries(initial)) store.set(key, { bytes, uploaded: new Date('2026-11-01T00:00:00Z') });
  const meta = (key: string): MirrorObject | null => {
    const entry = store.get(key);
    if (!entry) return null;
    const etag = `"${createHash('md5').update(entry.bytes).digest('hex')}"`;
    return { key, size: entry.bytes.byteLength, httpEtag: etag, uploaded: entry.uploaded, httpMetadata: { contentType: entry.contentType } };
  };
  const bucket: MirrorBucket = {
    async head(key) {
      return meta(key);
    },
    async get(key, options) {
      const object = meta(key);
      if (!object) return null;
      const bytes = store.get(key)!.bytes;
      const slice = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
      return { ...object, body: new Response(slice).body! };
    },
    async put(key, value, options) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      if (options?.sha256 && createHash('sha256').update(bytes).digest('hex') !== options.sha256) throw new Error('sha256 mismatch');
      store.set(key, { bytes, uploaded: new Date(), ...(options?.httpMetadata?.contentType ? { contentType: options.httpMetadata.contentType } : {}) });
      return meta(key);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    async list() {
      return { objects: [...store.keys()].map((key) => meta(key)!), truncated: false };
    },
  };
  return { bucket, store };
}

const TAG = 'baocut-v3.19.2-build.97';
const ZIP = 'BaoCut-3.19.2-build.97-aarch64-apple-darwin.zip';
const key = `${TAG}/${ZIP}`;
const bytes = new TextEncoder().encode('0123456789abcdefghij');
const request = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://baocut.com/releases/download/${TAG}/${ZIP}`, { method, headers });

describe('parseMirrorPath', () => {
  it('accepts release files whose name matches the tag', () => {
    expect(parseMirrorPath(`/releases/download/${TAG}/${ZIP}`)).toEqual({ tag: TAG, file: ZIP, key });
    expect(parseMirrorPath(`/releases/download/${TAG}/BaoCut-CLI-3.19.2-build.97-x86_64-pc-windows-msvc-cuda.zip`)?.key).toBe(
      `${TAG}/BaoCut-CLI-3.19.2-build.97-x86_64-pc-windows-msvc-cuda.zip`,
    );
  });

  it('rejects other files, other builds and odd paths', () => {
    expect(parseMirrorPath(`/releases/download/${TAG}/BaoCut-3.19.2-build.96-aarch64-apple-darwin.zip`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/${TAG}/${ZIP}.sha256`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/${TAG}/app-release.json`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/skill-v1.0.0/${ZIP}`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/${TAG}/x/${ZIP}`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/${TAG}/..%2F${ZIP}`)).toBeNull();
    expect(parseMirrorPath(`/releases/download/%E0%A4%A/${ZIP}`)).toBeNull();
  });
});

describe('parseRange', () => {
  it('reads one bytes range', () => {
    expect(parseRange('bytes=0-9', 20)).toEqual({ offset: 0, length: 10 });
    expect(parseRange('bytes=5-', 20)).toEqual({ offset: 5, length: 15 });
    expect(parseRange('bytes=-4', 20)).toEqual({ offset: 16, length: 4 });
    expect(parseRange('bytes=10-99', 20)).toEqual({ offset: 10, length: 10 });
    expect(parseRange('bytes=-99', 20)).toEqual({ offset: 0, length: 20 });
  });

  it('serves the whole file for missing or multi-part ranges and refuses ranges past the end', () => {
    expect(parseRange(null, 20)).toBeNull();
    expect(parseRange('bytes=0-1,4-5', 20)).toBeNull();
    expect(parseRange('items=0-1', 20)).toBeNull();
    expect(parseRange('bytes=9-3', 20)).toBeNull();
    expect(parseRange('bytes=20-', 20)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 20)).toBe('unsatisfiable');
  });
});

describe('serveMirror', () => {
  const file = parseMirrorPath(`/releases/download/${TAG}/${ZIP}`)!;

  it('sends files that are not mirrored yet to GitHub', async () => {
    for (const bucket of [undefined, memoryBucket().bucket]) {
      const response = await serveMirror(request(), bucket, file);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`https://github.com/jimliu/baocut/releases/download/${TAG}/${ZIP}`);
    }
  });

  it('serves the whole file with cache and range headers', async () => {
    const { bucket } = memoryBucket({ [key]: bytes });
    const response = await serveMirror(request(), bucket, file);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('20');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${ZIP}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('resumes from a byte offset', async () => {
    const { bucket } = memoryBucket({ [key]: bytes });
    const etag = (await bucket.head(key))!.httpEtag;
    const response = await serveMirror(request({ Range: 'bytes=15-', 'If-Range': etag }), bucket, file);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 15-19/20');
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(await response.text()).toBe('fghij');
  });

  it('ignores the range when If-Range names another version', async () => {
    const { bucket } = memoryBucket({ [key]: bytes });
    const response = await serveMirror(request({ Range: 'bytes=15-', 'If-Range': '"other"' }), bucket, file);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('0123456789abcdefghij');
  });

  it('answers HEAD, unsatisfiable ranges and matching ETags without a body', async () => {
    const { bucket } = memoryBucket({ [key]: bytes });
    const head = await serveMirror(request({}, 'HEAD'), bucket, file);
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('20');
    expect(head.body).toBeNull();
    const past = await serveMirror(request({ Range: 'bytes=20-' }), bucket, file);
    expect(past.status).toBe(416);
    expect(past.headers.get('Content-Range')).toBe('bytes */20');
    const etag = (await bucket.head(key))!.httpEtag;
    expect((await serveMirror(request({ 'If-None-Match': etag }), bucket, file)).status).toBe(304);
  });
});

describe('mirrorReleases', () => {
  const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  const content = (name: string) => new TextEncoder().encode(`contents of ${name}`);
  const asset = (tag: string, name: string, extra: Record<string, unknown> = {}) => ({
    name,
    state: 'uploaded',
    size: content(name).byteLength,
    digest: `sha256:${sha(content(name))}`,
    browser_download_url: `https://github.com/JimLiu/baocut/releases/download/${tag}/${name}`,
    ...extra,
  });
  const release = (version: string, build: number, names: string[], extra: Record<string, unknown> = {}) => {
    const tag = `baocut-v${version}-build.${build}`;
    return { tag_name: tag, draft: false, prerelease: false, assets: names.map((name) => asset(tag, name)), ...extra };
  };
  const github = [
    release('3.19.2', 97, [
      'BaoCut-3.19.2-build.97-aarch64-apple-darwin.zip',
      'BaoCut-3.19.2-build.97-aarch64-apple-darwin.zip.sha256',
      'BaoCut-CLI-3.19.2-build.97-aarch64-apple-darwin.zip',
      'appcast-aarch64-apple-darwin.json',
    ]),
    release('3.20.0', 98, [], { draft: true }),
    release('3.19.1', 96, ['BaoCut-3.19.1-build.96-win-x64-setup.exe']),
    release('3.19.0', 95, ['BaoCut-3.19.0-build.95-win-x64-setup.exe']),
    { tag_name: 'skill-v2.0.0', draft: false, prerelease: false, assets: [] },
  ];

  function deps(bucket: MirrorBucket, overrides: Partial<MirrorDeps> = {}): MirrorDeps & { downloads: string[] } {
    const downloads: string[] = [];
    return {
      bucket,
      downloads,
      now: () => 0,
      fixedLength: (body) => body,
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('https://api.github.com/')) return Response.json(github);
        downloads.push(url);
        const name = url.split('/').pop()!;
        return new Response(content(name), { headers: { 'Content-Length': String(content(name).byteLength) } });
      }) as unknown as typeof fetch,
      ...overrides,
    };
  }

  it(`keeps the newest ${KEEP_RELEASES} published releases and only installers and archives`, () => {
    const releases = mirrorReleasesFrom(github);
    expect(releases.map((r) => r.tag)).toEqual(['baocut-v3.19.2-build.97', 'baocut-v3.19.1-build.96']);
    expect(releases[0]!.assets.map((a) => a.file)).toEqual([
      'BaoCut-3.19.2-build.97-aarch64-apple-darwin.zip',
      'BaoCut-CLI-3.19.2-build.97-aarch64-apple-darwin.zip',
    ]);
    expect(releases[0]!.assets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('copies missing files, skips present ones and drops older releases', async () => {
    const present = 'baocut-v3.19.1-build.96/BaoCut-3.19.1-build.96-win-x64-setup.exe';
    const { bucket, store } = memoryBucket({
      [present]: content('BaoCut-3.19.1-build.96-win-x64-setup.exe'),
      'baocut-v3.18.0-build.90/BaoCut-3.18.0-build.90-win-x64-setup.exe': new Uint8Array(3),
    });
    const d = deps(bucket);
    const summary = await mirrorReleases(d);
    expect(summary.copied).toEqual([
      'baocut-v3.19.2-build.97/BaoCut-3.19.2-build.97-aarch64-apple-darwin.zip',
      'baocut-v3.19.2-build.97/BaoCut-CLI-3.19.2-build.97-aarch64-apple-darwin.zip',
    ]);
    expect(summary.present).toBe(1);
    expect(summary.failed).toEqual([]);
    expect(summary.deleted).toEqual(['baocut-v3.18.0-build.90/BaoCut-3.18.0-build.90-win-x64-setup.exe']);
    expect([...store.keys()].sort()).toEqual([present, ...summary.copied].sort());
    expect(store.get(summary.copied[0]!)!.contentType).toBe('application/zip');

    // 第二次什么都不用复制。
    const again = deps(bucket);
    expect((await mirrorReleases(again)).copied).toEqual([]);
    expect(again.downloads).toEqual([]);
  });

  it('keeps nothing half-copied and retries later', async () => {
    const { bucket, store } = memoryBucket();
    const d = deps(bucket, {
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('https://api.github.com/')) return Response.json(github);
        // 内容被换过：大小对得上，sha256 对不上。
        return new Response(new Uint8Array(content(url.split('/').pop()!).byteLength), {
          headers: { 'Content-Length': String(content(url.split('/').pop()!).byteLength) },
        });
      }) as typeof fetch,
    });
    const summary = await mirrorReleases(d);
    expect(summary.copied).toEqual([]);
    expect(summary.failed.map((f) => f.key)).toHaveLength(3);
    expect(store.size).toBe(0);
  });

  it('defers copies once the time budget is spent', async () => {
    const { bucket } = memoryBucket();
    let now = 0;
    const d = deps(bucket, { now: () => (now += 5 * 60 * 1000) });
    const summary = await mirrorReleases(d);
    expect(summary.copied.length + summary.deferred.length).toBe(3);
    expect(summary.deferred.length).toBeGreaterThan(0);
  });

  it('deletes nothing when GitHub cannot be read', async () => {
    const { bucket, store } = memoryBucket({ [key]: bytes });
    const d = deps(bucket, { fetch: (async () => new Response(null, { status: 403 })) as typeof fetch });
    await expect(mirrorReleases(d)).rejects.toThrow('HTTP 403');
    expect(store.has(key)).toBe(true);
  });
});

describe('worker route', () => {
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        return new Response(new URL(request.url).pathname, { headers: { 'Content-Type': 'text/plain' } });
      },
    },
  };
  const ctx = { waitUntil() {} };

  it('serves mirrored files and sends the rest to GitHub', async () => {
    const response = await worker.fetch(request(), env, ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://github.com/jimliu/baocut/releases/download/${TAG}/${ZIP}`);
    const { bucket } = memoryBucket({ [key]: bytes });
    const mirrored = await worker.fetch(request({ Range: 'bytes=0-3' }), { ...env, RELEASES: bucket }, ctx);
    expect(mirrored.status).toBe(206);
    expect(await mirrored.text()).toBe('0123');
    expect((await worker.fetch(new Request(`https://baocut.com/releases/download/${TAG}/notes.txt`), env, ctx)).status).toBe(404);
  });
});
