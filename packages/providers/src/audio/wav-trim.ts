/**
 * 克隆用的参考录音按 Provider 收的时长截短（架构设计 §6.4「音色克隆的请求」）。整数 PCM（16/24/32 位）或 32 位浮点的 WAV
 * 比上限长时只留开头一段：在上限之前最后约 3 秒里找最安静的 20 ms（所有声道的均方），切在那一帧的中点，不切在字中间；
 * 写出只含 `fmt ` 与 `data` 两块的 WAV，RIFF 与 data 的长度按截后的字节重写。不是 WAV、格式读不出或不比上限长时
 * 原样返回同一个 Buffer（逐字节相同），由调用方照原样上传。
 */

/** 在上限之前往回找静音的范围（秒）。 */
export const TRIM_SEARCH_SEC = 3;
/** 比较安静程度的一帧（秒）；相邻两帧重叠一半。 */
export const TRIM_FRAME_SEC = 0.02;

export interface WavTrim {
  bytes: Buffer;
  /** 截短后的时长（秒）；没截时 null。 */
  keptSec: number | null;
}

interface WavLayout {
  /** 原样的 `fmt ` 块（含 8 字节块头与补齐字节）。 */
  fmt: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  encoding: 'pcm' | 'float';
  /** 一个采样帧（所有声道）的字节数。 */
  blockAlign: number;
  dataStart: number;
  dataLength: number;
}

/** 比 `maxSec` 长的 WAV 只留开头、切在静音处；别的输入原样返回。 */
export function trimWavHead(bytes: Buffer, maxSec: number): WavTrim {
  const layout = wavLayout(bytes);
  if (!layout || !(maxSec > 0)) return { bytes, keptSec: null };
  const frames = Math.floor(layout.dataLength / layout.blockAlign);
  const limit = Math.floor(maxSec * layout.sampleRate);
  if (frames <= limit) return { bytes, keptSec: null };
  const cut = quietestCut(bytes, layout, limit);
  const kept = cut * layout.blockAlign;
  const pad = kept % 2;
  const out = Buffer.alloc(12 + layout.fmt.length + 8 + kept + pad);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVE', 8, 'ascii');
  layout.fmt.copy(out, 12);
  const data = 12 + layout.fmt.length;
  out.write('data', data, 'ascii');
  out.writeUInt32LE(kept, data + 4);
  bytes.copy(out, data + 8, layout.dataStart, layout.dataStart + kept);
  return { bytes: out, keptSec: cut / layout.sampleRate };
}

/** 切点（采样帧）：上限之前 `TRIM_SEARCH_SEC` 秒里最安静的一帧的中点；同样安静时取靠后的，多留一点录音。 */
function quietestCut(bytes: Buffer, layout: WavLayout, limit: number): number {
  const frame = Math.max(1, Math.round(TRIM_FRAME_SEC * layout.sampleRate));
  const hop = Math.max(1, Math.floor(frame / 2));
  const from = Math.max(0, limit - Math.round(TRIM_SEARCH_SEC * layout.sampleRate));
  let best = limit;
  let quietest = Infinity;
  for (let end = limit; end - frame >= from; end -= hop) {
    const energy = meanSquare(bytes, layout, end - frame, frame);
    if (energy < quietest) {
      quietest = energy;
      best = end - frame + Math.floor(frame / 2);
    }
  }
  return best;
}

function meanSquare(bytes: Buffer, layout: WavLayout, start: number, frames: number): number {
  const width = layout.bitsPerSample / 8;
  const count = frames * layout.channels;
  let sum = 0;
  let at = layout.dataStart + start * layout.blockAlign;
  for (let i = 0; i < count; i++, at += width) {
    const value = sampleAt(bytes, at, layout);
    sum += value * value;
  }
  return sum / count;
}

function sampleAt(bytes: Buffer, at: number, layout: WavLayout): number {
  if (layout.encoding === 'float') {
    const value = bytes.readFloatLE(at);
    return Number.isFinite(value) ? value : 0;
  }
  if (layout.bitsPerSample === 16) return bytes.readInt16LE(at) / 32_768;
  if (layout.bitsPerSample === 24) return bytes.readIntLE(at, 3) / 8_388_608;
  return bytes.readInt32LE(at) / 2_147_483_648;
}

/** RIFF/WAVE 的块布局；不是能截的 WAV（缺块、块越界、编码或位深不支持）时 null。 */
function wavLayout(bytes: Buffer): WavLayout | null {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt: Omit<WavLayout, 'dataStart' | 'dataLength'> | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + size > bytes.length) return null;
      let format = bytes.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE：真正的格式在子格式 GUID 的前两个字节。
      if (format === 0xfffe) {
        if (size < 26) return null;
        format = bytes.readUInt16LE(body + 24);
      }
      const channels = bytes.readUInt16LE(body + 2);
      const sampleRate = bytes.readUInt32LE(body + 4);
      const bitsPerSample = bytes.readUInt16LE(body + 14);
      const encoding = format === 1 ? 'pcm' : format === 3 ? 'float' : null;
      const supported = encoding === 'float' ? bitsPerSample === 32 : bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32;
      if (!encoding || !supported || channels < 1 || sampleRate < 1) return null;
      const chunk = Buffer.alloc(8 + size + (size % 2));
      bytes.copy(chunk, 0, offset, body + size);
      fmt = { fmt: chunk, sampleRate, channels, bitsPerSample, encoding, blockAlign: channels * (bitsPerSample / 8) };
    } else if (id === 'data') {
      if (!fmt) return null;
      // 写不了长度的流式 WAV 里 data 的长度是 0 或 0xFFFFFFFF：按文件的实际大小算。
      const length = size === 0 || size === 0xffffffff || body + size > bytes.length ? bytes.length - body : size;
      return { ...fmt, dataStart: body, dataLength: length };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
