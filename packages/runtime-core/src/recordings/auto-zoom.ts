import type { RecordingPackage } from './recording-package.ts';

/** 自动生成的一个缩放区间（屏幕取景 §4.9 的 `ScreenZoom`，`origin: 'auto'`），刻度是取景文档的。 */
export interface AutoZoom {
  id: string;
  t0: string;
  t1: string;
  scale: number;
  focus: { kind: 'pointer' } | { kind: 'point'; x: number; y: number };
  origin: 'auto';
  rampIn?: string;
  rampOut?: string;
}

/**
 * 按点击生成自动缩放（屏幕录制设计 §8「自动缩放」）的调用点：收尾时在写屏幕取景文档之前调用，结果进 `zooms`。
 * `pointerTracks` 是各段换算好的指针轨（格式规范 §4.8 的正文，键是流 ID）。
 *
 * 现在什么都不生成：返回空数组，录制的结果带 `autoZoomPending: true`。
 */
export function generateAutoZooms(_pkg: RecordingPackage, _pointerTracks: ReadonlyMap<string, unknown>, _timescale: number): AutoZoom[] {
  // TODO(screen-recording stage 3): derive click clusters from the pointer tracks (recording time = stream.start + t), merge
  // nearby clicks into zoom intervals with ramps, keep them non-overlapping and inside [0, duration), then return them here.
  return [];
}
