import { PLAYBACK_CODECS, type MediaHandle, type MediaPlayback, type PlaybackCodec } from '@baocut/protocol';

interface PlaybackClient {
  request(method: 'media.playback', params: { url: string; playable?: PlaybackCodec[] }): Promise<MediaPlayback>;
}

/** `canPlayType` 的探测串：带上编码，浏览器才答得准（能放是 'probably'）。 */
const CODEC_TYPES: Record<PlaybackCodec, string> = {
  vp8: 'video/webm; codecs="vp8"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/webm; codecs="av01.0.08M.08"',
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/webm; codecs="vorbis"',
};

let detected: PlaybackCodec[] | null = null;

/** 这个浏览器能原生解码的 WebM 编码（Chromium 与 Electron 全都能，Safari 看版本）。没有 DOM 时是空的。 */
export function playableCodecs(): PlaybackCodec[] {
  if (detected) return detected;
  if (typeof document === 'undefined') return [];
  const probe = document.createElement('video');
  detected = PLAYBACK_CODECS.filter((codec) => probe.canPlayType(CODEC_TYPES[codec]) === 'probably');
  return detected;
}

/**
 * Playback only: downloads and file viewers keep the original handle. WebM whose codecs this browser decodes plays
 * from the original file; otherwise the Runtime prepares a compatible copy and we poll until it is ready.
 */
export async function preparePlaybackMedia(
  client: PlaybackClient,
  original: MediaHandle,
  signal?: AbortSignal,
  playable: PlaybackCodec[] = playableCodecs(),
): Promise<MediaHandle> {
  signal?.throwIfAborted();
  // Unsent attachments belong to the browser, not the Runtime grant registry.
  if (/^(blob|data):/i.test(original.url)) return original;
  if (!['video/webm', 'audio/webm'].includes(original.mimeType.split(';')[0]!.trim().toLowerCase())) return original;
  const params = playable.length > 0 ? { url: original.url, playable } : { url: original.url };
  for (;;) {
    signal?.throwIfAborted();
    const result = await client.request('media.playback', params);
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
