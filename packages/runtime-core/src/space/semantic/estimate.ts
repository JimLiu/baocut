import type { SemanticEstimate } from '@baocut/protocol';
import type { EmbeddingProfile } from '@baocut/models';
import type { SemanticStore } from './store.ts';
import { frameTimes } from './visual-lane.ts';

/**
 * 建索引要多久（检索规格 §13.2）：每一路按这台机器实测的速度（指数滑动平均）乘待建的量。速度跟着编码实现与设备存在库的
 * `meta` 里（`rate:text`、`rate:visual`），换了模型包或设备就不再用旧的。
 *
 * - 文字：每秒视频（时间线时长）要编码多少秒；只在一个视频大部分句群都要新编码时记（缓存命中多的视频会把速度量得太快）。
 *   没量过时不估。
 * - 画面：每帧多少秒（取帧加编码）；没量过时用 G0 多模态评测在 CPU 上的速度（每小时视频约 7.5–9 分钟，每 8 秒一帧）。
 *   帧数按时间线时长与取帧间隔估：素材比时间线长（剪掉了部分）时会少算。
 */

const RATE_ALPHA = 0.2;
/** G0：CPU 上每帧约 1.0–1.2 秒（取帧加编码）。 */
export const DEFAULT_VISUAL_SECONDS_PER_FRAME = 1.1;
/** 记文字速度的门槛：至少这么多比例的句群是新编码的。 */
export const TEXT_RATE_MIN_FRESH = 0.8;

type RateChannel = 'text' | 'visual';

interface StoredRate {
  encoderProfileId: string;
  device: string | null;
  perUnit: number;
}

const rateKey = (channel: RateChannel) => `rate:${channel}`;

/** 记一次实测（`perUnit`：文字是秒 / 视频秒，画面是秒 / 帧）。 */
export function recordRate(store: SemanticStore, channel: RateChannel, profile: Pick<EmbeddingProfile, 'encoderProfileId' | 'device'>, perUnit: number): void {
  if (!(perUnit > 0) || !Number.isFinite(perUnit)) return;
  const previous = readRate(store, channel, profile);
  const next = previous === null ? perUnit : previous + RATE_ALPHA * (perUnit - previous);
  const value: StoredRate = { encoderProfileId: profile.encoderProfileId, device: profile.device ?? null, perUnit: next };
  store.setMeta(rateKey(channel), JSON.stringify(value));
}

/** 这个编码实现、这个设备上量过的速度；没量过或换了时 null。 */
export function readRate(store: SemanticStore, channel: RateChannel, profile: Pick<EmbeddingProfile, 'encoderProfileId' | 'device'>): number | null {
  const raw = store.getMeta(rateKey(channel));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredRate>;
    if (stored.encoderProfileId !== profile.encoderProfileId || (stored.device ?? null) !== (profile.device ?? null)) return null;
    return typeof stored.perUnit === 'number' && stored.perUnit > 0 ? stored.perUnit : null;
  } catch {
    return null;
  }
}

/** 一段时长要取几帧（与画面索引取帧的间隔、上限一致）。 */
export function framesFor(durationSec: number): number {
  return durationSec > 0 ? frameTimes(durationSec).length : 0;
}

export interface EstimateInput {
  channel: RateChannel;
  /** 待建视频的时间线时长（秒）；不知道时 null。 */
  durations: readonly (number | null)[];
  /** 这一路的 profile；拿不到（没装能用的模型包）时 null，不估时间。 */
  profile: Pick<EmbeddingProfile, 'encoderProfileId' | 'device' | 'dims'> | null;
  store: SemanticStore | null;
  /** 这一路没开：估的是打开之后要建的量。 */
  ifEnabled: boolean;
}

export function estimateOf(input: EstimateInput): SemanticEstimate {
  let sourceSeconds = 0;
  let unknownDuration = 0;
  let frames = 0;
  for (const duration of input.durations) {
    if (duration === null || !(duration > 0)) {
      unknownDuration++;
      continue;
    }
    sourceSeconds += duration;
    if (input.channel === 'visual') frames += framesFor(duration);
  }
  const measured = input.profile && input.store ? readRate(input.store, input.channel, input.profile) : null;
  const rate = measured ?? (input.channel === 'visual' && input.profile ? DEFAULT_VISUAL_SECONDS_PER_FRAME : null);
  const units = input.channel === 'visual' ? frames : sourceSeconds;
  return {
    channel: input.channel,
    ifEnabled: input.ifEnabled,
    videos: input.durations.length,
    unknownDuration,
    sourceSeconds: Math.round(sourceSeconds),
    frames: input.channel === 'visual' ? frames : null,
    seconds: rate === null ? null : Math.round(rate * units),
    basis: rate === null ? null : measured !== null ? 'measured' : 'default',
    // 画面向量：每帧一条 FP32 向量（帧缓存另算，可以清掉）。
    vectorBytes: input.channel === 'visual' && input.profile ? frames * input.profile.dims * 4 : null,
  };
}
