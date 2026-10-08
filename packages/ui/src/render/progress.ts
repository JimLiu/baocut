import { elementPresets, lazyObject, type ProgressPreset } from '@baocut/editor-wasm';

/**
 * 进度条（`baocut.progress`）的 14 款：次序、盒形与默认主副色读 `motion` 的内置配方（经编辑语义 WASM），渲染画的是同一份。
 * `square` 的几款在框里取内切正方形，`bar` 与 `frame` 用整个框。这里是新建与属性页用的样式目录；画法在渲染内核里。
 */
export type ProgressStyle = ProgressPreset;

/** 键序就是配方的 `order`（属性页样式目录的次序）。 */
export const PROGRESS_STYLES: Readonly<Record<string, ProgressStyle>> = lazyObject(() =>
  Object.fromEntries(elementPresets().progress.map((preset) => [preset.id, preset])),
);
