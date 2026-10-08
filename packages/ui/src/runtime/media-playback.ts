import type { MediaHandle, MediaPlayback } from '@baocut/protocol';

interface PlaybackClient {
  request(method: 'media.playback', params: { url: string }): Promise<MediaPlayback>;
}

/** Playback only: downloads and file viewers keep the original handle. */
export async function preparePlaybackMedia(client: PlaybackClient, original: MediaHandle, signal?: AbortSignal): Promise<MediaHandle> {
  signal?.throwIfAborted();
  // Unsent attachments belong to the browser, not the Runtime grant registry.
  if (/^(blob|data):/i.test(original.url)) return original;
  if (!['video/webm', 'audio/webm'].includes(original.mimeType.split(';')[0]!.trim().toLowerCase())) return original;
  for (;;) {
    signal?.throwIfAborted();
    const result = await client.request('media.playback', { url: original.url });
    signal?.throwIfAborted();
    if (result.status === 'ready') return result.media;
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, Math.max(100, Math.min(1000, result.retryAfterMs)));
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }
}
