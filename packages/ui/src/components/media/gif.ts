import { useEffect, useState } from 'react';
import { MAX_BYTES, parseGif } from '../../model/media-gif.ts';
export interface GifFrame {
  url: string;
  blob: Blob;
  duration: number;
}
export interface GifData {
  width: number;
  height: number;
  frames: GifFrame[];
  bytes: Uint8Array<ArrayBuffer>;
  dispose(): void;
}
interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
interface DecoderClass {
  new (options: { data: Uint8Array; type: string; preferAnimation: boolean }): Decoder;
  isTypeSupported(type: string): Promise<boolean>;
}
export async function decodeGif(url: string, signal: AbortSignal): Promise<GifData> {
  const ImageDecoder = (globalThis as unknown as { ImageDecoder?: DecoderClass }).ImageDecoder;
  if (!ImageDecoder || !(await ImageDecoder.isTypeSupported('image/gif'))) throw new Error('GIF decoder unavailable');
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error('GIF unavailable');
  const reader = response.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('GIF limit');
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()),
    info = parseGif(bytes),
    frames: GifFrame[] = [];
  const decoder = new ImageDecoder({ data: bytes, type: 'image/gif', preferAnimation: true }),
    dispose = () => frames.forEach((frame) => URL.revokeObjectURL(frame.url));
  const abort = () => decoder.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await decoder.tracks.ready;
    signal.throwIfAborted();
    if (decoder.tracks.selectedTrack.frameCount !== info.frames.length) throw new Error('GIF frame count');
    const canvas = new OffscreenCanvas(info.width, info.height),
      ctx = canvas.getContext('2d')!;
    for (let i = 0; i < info.frames.length; i++) {
      signal.throwIfAborted();
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        ctx.clearRect(0, 0, info.width, info.height);
        ctx.drawImage(image, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        signal.throwIfAborted();
        frames.push({ url: URL.createObjectURL(blob), blob, duration: info.frames[i]!.duration });
      } finally {
        image.close();
      }
    }
    return { ...info, frames, bytes, dispose };
  } catch (e) {
    dispose();
    throw e;
  } finally {
    signal.removeEventListener('abort', abort);
    decoder.close();
  }
}
export function useGif(url: string, enabled: boolean) {
  const [data, setData] = useState<GifData | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setData(null);
    setFailed(false);
    if (!enabled) return;
    const abort = new AbortController();
    let value: GifData | undefined;
    void decodeGif(url, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) {
          next.dispose();
          return;
        }
        value = next;
        setData(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => {
      abort.abort();
      value?.dispose();
    };
  }, [url, enabled, attempt]);
  return { data, failed, retry: () => setAttempt((n) => n + 1) };
}
export async function loadPreviewImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyPreviewImage(url: string) {
  const image = await loadPreviewImage(url),
    canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Image unavailable');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
export async function gifContactSheet(gif: GifData) {
  const columns = Math.ceil(Math.sqrt(gif.frames.length)),
    size = Math.min(240, Math.floor(2048 / columns));
  const canvas = document.createElement('canvas');
  canvas.width = columns * size;
  canvas.height = Math.ceil(gif.frames.length / columns) * (size + 24);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < gif.frames.length; i++) {
    const img = await loadPreviewImage(gif.frames[i]!.url),
      x = (i % columns) * size,
      y = Math.floor(i / columns) * (size + 24),
      s = Math.min(size / img.width, size / img.height);
    ctx.drawImage(img, x + (size - img.width * s) / 2, y, img.width * s, img.height * s);
    ctx.fillStyle = '#000';
    ctx.font = '16px sans-serif';
    ctx.fillText(String(i + 1), x + 8, y + size + 18);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Image unavailable');
  return new File([blob], 'frames.png', { type: 'image/png' });
}
