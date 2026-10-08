import type { AssetDecoder } from './asset-source.ts';
import type { RenderPlanner } from './render-planner.ts';

/**
 * 预览分析声音的素材上限（字节）：更大的素材整份读进页面、解码成样本太占内存，预览不分析，声波按静止的样子画并报出来；
 * 导出不受这个限制（Render Worker 从文件解码）。
 */
export const SPECTRUM_MAX_BYTES = 512 * 1024 * 1024;

/** 解码出来的各声道样本（48 kHz）。 */
export type DecodeAudio = (bytes: ArrayBuffer) => Promise<Float32Array[]>;

/**
 * 素材频谱的解码器（素材缓存按素材版本各算一次）：浏览器把素材的声音解成 48 kHz 的样本，再交给预览 WASM 里与导出
 * 同一份的分析算成 BCS1。没有声音的素材解不出来，缓存记为失败，声波按静止的样子画并报出来。
 */
export function spectrumDecoder(
  planner: Pick<RenderPlanner, 'analyzeAudio'>,
  decode: DecodeAudio = decodeWithWebAudio,
): AssetDecoder<Uint8Array> {
  return {
    name: 'spectrum',
    decode: async (response) => planner.analyzeAudio(await decode(await response.arrayBuffer())),
  };
}

/** Web Audio 解码：解码时就重采样到上下文的 48 kHz，声道原样保留。 */
export async function decodeWithWebAudio(bytes: ArrayBuffer): Promise<Float32Array[]> {
  const context = new OfflineAudioContext(1, 1, 48_000);
  const buffer = await context.decodeAudioData(bytes);
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}
