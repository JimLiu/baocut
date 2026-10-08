import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Id, MediaHandle, VersionRef } from '@baocut/protocol';
import { RuntimeContext } from '../../runtime/context.tsx';
import { MediaUrlCache } from '../../runtime/media-url-cache.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useAssetUrl } from './use-asset-url.ts';

const granted: MediaHandle = {
  url: 'http://media/grant-1',
  mimeType: 'audio/wav',
  size: 1,
  fileName: 'a.wav',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function Probe({ videoId, asset }: { videoId: Id | null; asset: VersionRef }) {
  const { url, error } = useAssetUrl(videoId, asset);
  return createElement('i', { 'data-url': url ?? '', 'data-error': error ?? '' });
}

/** 只渲染第一次（服务端渲染不跑 effect）：看挂上那一刻给出的地址。 */
function firstRender(cache: MediaUrlCache, videoId: Id | null, assets: VersionRef[]): string {
  const runtime = { videos: { mediaUrls: cache } } as unknown as RuntimeSession;
  return renderToStaticMarkup(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      assets.map((asset, i) => createElement(Probe, { key: i, videoId, asset })),
    ),
  );
}

describe('useAssetUrl', () => {
  it('缓存里有新鲜的地址：第一次渲染就给出，不等 effect', async () => {
    const resolve = vi.fn(async () => granted);
    const cache = new MediaUrlCache(resolve);
    await cache.get('vid1', { id: 'asset_a', revision: '1' });
    const html = firstRender(
      cache,
      'vid1',
      Array.from({ length: 1000 }, () => ({ id: 'asset_a', revision: '1' })),
    );
    expect(html.split(`data-url="${granted.url}"`).length - 1).toBe(1000);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('别的素材、别的版本、没有视频：第一次渲染不借用别人的地址', async () => {
    const cache = new MediaUrlCache(async () => granted);
    await cache.get('vid1', { id: 'asset_a', revision: '1' });
    expect(firstRender(cache, 'vid1', [{ id: 'asset_b', revision: '1' }])).toContain('data-url=""');
    expect(firstRender(cache, 'vid1', [{ id: 'asset_a', revision: '2' }])).toContain('data-url=""');
    expect(firstRender(cache, 'vid2', [{ id: 'asset_a', revision: '1' }])).toContain('data-url=""');
    expect(firstRender(cache, null, [{ id: 'asset_a', revision: '1' }])).toContain('data-url=""');
  });
});
