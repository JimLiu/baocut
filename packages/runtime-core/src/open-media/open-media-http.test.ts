import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPEN_MEDIA_USER_AGENT, OpenMediaHttp, checkDownloadUrl } from './open-media-http.ts';

type Handler = (url: string, init: RequestInit) => Response;

function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fetch: fn, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-media-http-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('open media http', () => {
  it('sends the BaoCut user agent and retries 5xx', async () => {
    let n = 0;
    const fake = fakeFetch(() => (++n < 3 ? new Response('busy', { status: 503 }) : Response.json({ ok: true })));
    const http = new OpenMediaHttp({ fetch: fake.fetch, backoffMs: () => 0 });
    await expect(http.json('https://commons.wikimedia.org/w/api.php?x=1')).resolves.toEqual({ ok: true });
    expect(fake.calls).toHaveLength(3);
    expect((fake.calls[0]!.init.headers as Record<string, string>)['User-Agent']).toBe(OPEN_MEDIA_USER_AGENT);
  });

  it('does not retry other 4xx', async () => {
    const fake = fakeFetch(() => new Response('nope', { status: 404 }));
    const http = new OpenMediaHttp({ fetch: fake.fetch, backoffMs: () => 0 });
    await expect(http.json('https://archive.org/metadata/x')).rejects.toMatchObject({ code: 'OPEN_MEDIA_NOT_FOUND' });
    expect(fake.calls).toHaveLength(1);
  });

  it('refuses hosts outside the allow list, including on redirect', async () => {
    expect(() => checkDownloadUrl('http://upload.wikimedia.org/a.jpg')).toThrow(expect.objectContaining({ code: 'OPEN_MEDIA_REJECTED' }));
    expect(() => checkDownloadUrl('https://example.com/a.jpg')).toThrow(expect.objectContaining({ code: 'OPEN_MEDIA_REJECTED' }));
    const fake = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://example.com/a.mp4' } }));
    const http = new OpenMediaHttp({ fetch: fake.fetch, backoffMs: () => 0 });
    await expect(http.download('https://archive.org/download/x/a.mp4', path.join(dir, 'a.mp4'), 1000)).rejects.toMatchObject({
      code: 'OPEN_MEDIA_REJECTED',
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('follows allowed redirects and writes the file', async () => {
    const fake = fakeFetch((url) =>
      url.startsWith('https://archive.org/')
        ? new Response(null, { status: 302, headers: { location: 'https://ia800.us.archive.org/a.mp4' } })
        : new Response('hello'),
    );
    const http = new OpenMediaHttp({ fetch: fake.fetch, backoffMs: () => 0 });
    const file = path.join(dir, 'a.mp4');
    await expect(http.download('https://archive.org/download/x/a.mp4', file, 1000)).resolves.toBe(5);
    expect(await fs.readFile(file, 'utf8')).toBe('hello');
  });

  it('stops over the size limit and removes the partial file', async () => {
    const fake = fakeFetch(() => new Response('0123456789'));
    const http = new OpenMediaHttp({ fetch: fake.fetch, backoffMs: () => 0 });
    const file = path.join(dir, 'big.bin');
    await expect(http.download('https://upload.wikimedia.org/big.bin', file, 4)).rejects.toMatchObject({ code: 'OPEN_MEDIA_TOO_LARGE' });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
