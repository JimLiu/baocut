import type { FrameScore } from '../media-analysis.ts';

/**
 * 镜头切换的另外两种判据（`videos_shots` 的 `method`）：按 PySceneDetect（BSD-3-Clause）的 `AdaptiveDetector` 与 `ThresholdDetector`
 * 的做法，在 ffmpeg 给的逐帧分数上算，不用 Python、不用 OpenCV。不碰文件。
 *
 * - `adaptive`：一帧的场景分数除以前后 `window` 帧的平均分。分数本身大、又明显高于前后的才算切换，所以手持晃动、快速运动这种
 *   每帧都高的画面不会连着误报；固定阈值（`scene`）管不了这种。
 * - `fade`：画面亮度掉到 `luma` 以下、再回到它以上算一次淡出淡入，切点放在两次穿越的中点。固定阈值（`scene`）看相邻两帧，渐变每帧都
 *   只差一点，会漏掉。开头就是黑场时不算（前面没有镜头）。
 */

/** 前后各看几帧（PySceneDetect 的 `window_width` 缺省值）。 */
const ADAPTIVE_WINDOW = 2;
/** `adaptive` 的缺省比值（PySceneDetect 的 `adaptive_threshold` 缺省值）。 */
export const DEFAULT_ADAPTIVE_RATIO = 3;
/** 分数低于它的帧不算切换，再高的比值也不算：静止画面上的一点噪声除以接近 0 的平均分会得到很大的比值。 */
export const ADAPTIVE_MIN_SCORE = 0.1;
/** `fade` 的缺省亮度（0–1，约等于 PySceneDetect 的 `threshold=12`）。 */
export const DEFAULT_FADE_LUMA = 0.05;

/** 一处切换：源时钟上的秒与分数。 */
export interface DetectedCut {
  at: number;
  score: number;
}

export function adaptiveCuts(frames: readonly FrameScore[], ratio: number = DEFAULT_ADAPTIVE_RATIO): DetectedCut[] {
  const cuts: DetectedCut[] = [];
  for (let i = 0; i < frames.length; i++) {
    const score = frames[i]!.score;
    if (score < ADAPTIVE_MIN_SCORE) continue;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - ADAPTIVE_WINDOW); j <= Math.min(frames.length - 1, i + ADAPTIVE_WINDOW); j++) {
      if (j === i) continue;
      sum += frames[j]!.score;
      count += 1;
    }
    const average = count > 0 ? sum / count : 0;
    if (average <= 0 || score / average >= ratio) cuts.push({ at: frames[i]!.at, score });
  }
  return cuts;
}

export function fadeCuts(frames: readonly FrameScore[], luma: number = DEFAULT_FADE_LUMA): DetectedCut[] {
  const cuts: DetectedCut[] = [];
  let seenPicture = false;
  let darkSince: number | null = null;
  for (const frame of frames) {
    if (frame.luma < luma) {
      // 开头的黑场前面没有镜头，不算淡出。
      if (seenPicture && darkSince === null) darkSince = frame.at;
      continue;
    }
    if (darkSince !== null) {
      cuts.push({ at: (darkSince + frame.at) / 2, score: 1 });
      darkSince = null;
    }
    seenPicture = true;
  }
  return cuts;
}
