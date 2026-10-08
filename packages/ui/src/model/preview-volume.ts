/**
 * 编辑器预览的监听音量（原型 editor-keys.jsx 借全屏播放器的键、model-player.js `stepVolume`）：
 * 播放中 ↑/↓ 一档 10，调大顺手取消静音，调到 0 算静音；M 切静音。只是这个窗口听到的大小，不写进视频、不影响导出。
 */

/** 音量 0–100 的整数；静音时音量照记，取消静音回到原来的大小。 */
export interface MonitorLevel {
  volume: number;
  muted: boolean;
}

export const VOLUME_STEP = 10;
export const FULL_VOLUME: MonitorLevel = { volume: 100, muted: false };

/** ↑（`1`）/ ↓（`-1`）：从记着的音量走一档；往上走取消静音，往下走到 0 才算静音（原型 `stepVol`）。 */
export function stepMonitor(level: MonitorLevel, direction: 1 | -1): MonitorLevel {
  const volume = Math.min(100, Math.max(0, Math.round((level.volume || 0) + direction * VOLUME_STEP)));
  return { volume, muted: direction > 0 ? false : volume === 0 };
}

export function toggleMute(level: MonitorLevel): MonitorLevel {
  return { ...level, muted: !level.muted };
}

/** 交给预览引擎的倍数（0–1）。 */
export function monitorGain(level: MonitorLevel): { volume: number; muted: boolean } {
  return { volume: Math.min(1, Math.max(0, level.volume / 100)), muted: level.muted };
}

/** 引擎记着的倍数换回 0–100。 */
export function monitorLevel(gain: { volume: number; muted: boolean }): MonitorLevel {
  return { volume: Math.round(Math.min(1, Math.max(0, gain.volume)) * 100), muted: gain.muted };
}
