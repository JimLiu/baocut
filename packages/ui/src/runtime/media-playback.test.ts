import { describe, expect, it, vi } from 'vitest';
import type { MediaHandle, MediaPlayback } from '@baocut/protocol';
import { preparePlaybackMedia } from './media-playback.ts';

const original: MediaHandle = { url: '/media/source/clip.webm', mimeType: 'video/webm', fileName: 'clip.webm', size: 42, expiresAt: '2099-01-01T00:00:00Z' };
const compatible: MediaHandle = { ...original, url: '/media/cache/preview.mp4', mimeType: 'video/mp4' };

describe('compatible playback handles', () => {
  it('polls short requests until ready without replacing the download handle', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<() => Promise<MediaPlayback>>()
        .mockResolvedValueOnce({ status: 'pending', retryAfterMs: 250 })
        .mockResolvedValueOnce({ status: 'ready', media: compatible });
      const pending = preparePlaybackMedia({ request }, original);
      await vi.advanceTimersByTimeAsync(250);
      expect(await pending).toBe(compatible);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenCalledWith('media.playback', { url: original.url });
      expect(original.url).toBe('/media/source/clip.webm');
    } finally { vi.useRealTimers(); }
  });

  it('passes ordinary media through without requesting conversion', async () => {
    const request = vi.fn();
    const mp4 = { ...original, mimeType: 'video/mp4' };
    expect(await preparePlaybackMedia({ request }, mp4)).toBe(mp4);
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps unsent browser-only attachments local', async () => {
    const request = vi.fn();
    for (const url of ['blob:local-attachment', 'data:video/webm;base64,AAAA']) {
      const local = { ...original, url };
      expect(await preparePlaybackMedia({ request }, local)).toBe(local);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('abandons polling when the player changes source or closes', async () => {
    const controller = new AbortController();
    const request = vi.fn<() => Promise<MediaPlayback>>().mockResolvedValue({ status: 'pending', retryAfterMs: 250 });
    const pending = preparePlaybackMedia({ request }, original, controller.signal);
    const failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await failed;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propagates conversion failures through the existing player error path', async () => {
    const error = new Error('codec unavailable');
    const request = vi.fn().mockRejectedValue(error);
    await expect(preparePlaybackMedia({ request }, original)).rejects.toBe(error);
  });
});
