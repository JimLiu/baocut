import { elementPresets, lazyObject, type VisualizerPreset } from '@baocut/editor-wasm';

/**
 * 声波（`baocut.audio-visualizer`）的 10 款与旧名：次序、盒形、默认颜色与 dB 窗读 `motion` 的内置配方（经编辑语义 WASM），
 * 渲染画的是同一份。`square` 的几款在框里取内切正方形；`hasControl` 为 false 的两款（示波器、环形波）读时域行，
 * dB 窗、平滑与增益对它们不起作用。频谱的分析在宿主（BCS1），派生与绘制在渲染内核里。
 */
export type WaveStyle = VisualizerPreset;

const presets = lazyObject(() => elementPresets());

/** 键序就是配方的 `order`（属性页样式目录的次序）。 */
export const WAVE_STYLES: Readonly<Record<string, WaveStyle>> = lazyObject(() =>
  Object.fromEntries(presets.visualizer.map((preset) => [preset.id, preset])),
);

/** 样式名（含旧目录合并掉的旧名，老视频照常打开）→ 目录里的键；认不出时 null。 */
export function waveStyleKey(name: string): string | null {
  const key = presets.visualizerAliases[name] ?? name;
  return WAVE_STYLES[key] ? key : null;
}
