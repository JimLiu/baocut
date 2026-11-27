import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOL_MANIFESTS, YT_DLP } from './tool-manifests.ts';
import { latestUpstreamAsset, parseChecksums } from './tool-upstream.ts';

/** 查上游最新的稳定版（架构设计 §12.9「自动更新」）：只认稳定版、github.com 上的摘要清单，摘要两处要一致。不访问网络。 */

const upstream = BUILTIN_TOOL_MANIFESTS.find((m) => m.name === YT_DLP)!.upstream!;
const SHA = 'a'.repeat(64);
const SUMS = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.20/SHA2-256SUMS';

function fakeFetch(release: Record<string, unknown>, sums = `${SHA}  yt-dlp_macos.zip\n${'b'.repeat(64)} *yt-dlp.exe\n`) {
  const asked: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (url === upstream.latestApi) return Response.json(release);
    if (url === SUMS) return new Response(sums);
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const release = (patch: Record<string, unknown> = {}) => ({
  tag_name: '2026.11.20',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'yt-dlp_macos.zip', size: 54_000_000, digest: `sha256:${SHA}`, browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.20/yt-dlp_macos.zip' },
    { name: 'SHA2-256SUMS', size: 1000, browser_download_url: SUMS },
  ],
  ...patch,
});

describe('上游最新稳定版', () => {
  it('交出版本、大小与摘要清单里的 sha256', async () => {
    const { fetch, asked } = fakeFetch(release());
    await expect(latestUpstreamAsset(upstream, 'yt-dlp_macos.zip', { fetch })).resolves.toEqual({
      version: '2026.11.20',
      fileName: 'yt-dlp_macos.zip',
      size: 54_000_000,
      sha256: SHA,
    });
    expect(asked).toEqual([upstream.latestApi, SUMS]);
  });

  it('不认预发布、不像版本号的标签、清单里没有的文件、不在 github.com 的清单、两处摘要不一致', async () => {
    const reject = (r: Record<string, unknown>, sums?: string) => expect(latestUpstreamAsset(upstream, 'yt-dlp_macos.zip', { fetch: fakeFetch(r, sums).fetch })).rejects.toThrow();
    await reject(release({ prerelease: true }));
    await reject(release({ tag_name: 'nightly' }));
    await reject(release(), `${'b'.repeat(64)}  yt-dlp.exe\n`);
    await reject(release({ assets: [release().assets[0], { name: 'SHA2-256SUMS', browser_download_url: 'https://example.com/SHA2-256SUMS' }] }));
    await reject(release({ assets: [{ ...release().assets[0], digest: `sha256:${'c'.repeat(64)}` }, release().assets[1]] }));
    await reject(release({ assets: [{ ...release().assets[0], size: 0 }, release().assets[1]] }));
  });

  it('解析 sha256sum 的输出：去掉二进制模式的 *，十六进制转小写', () => {
    expect(parseChecksums(`${'A'.repeat(64)}  one\r\n${'b'.repeat(64)} *two\nnot a line\n`)).toEqual(
      new Map([
        ['one', 'a'.repeat(64)],
        ['two', 'b'.repeat(64)],
      ]),
    );
  });
});
