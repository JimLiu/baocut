import { refOf, type Localized, type MessageRef } from '@baocut/protocol';
import { ModelsSeparationSelfTest as M } from '@baocut/protocol/messages/models/separation-self-test.ts';
import { parseWav, SPEECH_SELF_TEST_LIMITS, type WavFacts } from './speech-self-test.ts';

/**
 * 分离模型包的自检（`models.test`，Model Worker 协议规范 §4.3）：把识别自检的英文朗读样本（只有人声）整段分离，
 * 判定两路输出。阈值写在协议规范里。
 */
export const SEPARATION_SELF_TEST_LIMITS = {
  /** 两路输出与样本的时长之差的上限（秒，一帧音频 20 毫秒）。 */
  durationToleranceSec: 0.02,
  /** 人声的均方根低于这个值就当作静音（与合成自检相同）。 */
  minVocalsRms: SPEECH_SELF_TEST_LIMITS.minRms,
  /** 样本只有人声：人声的均方根至少是背景的这么多倍（约 6 dB）。 */
  minVocalsToBackground: 2,
} as const;

export type SeparationSelfTestVerdict =
  | { passed: true; vocals: WavFacts; background: WavFacts }
  | { passed: false; problem: string; problemRef?: MessageRef; vocals?: WavFacts; background?: WavFacts };

/**
 * 判定：两路都能解码、立体声、采样率相同、与样本等长；人声不是静音，并且明显比背景响。不通过时 `problem` 是当前语言的文本，
 * `problemRef` 是它的消息引用。
 */
export function separationSelfTestVerdict(
  stems: { vocals: Buffer; background: Buffer },
  sampleDurationSec: number,
): SeparationSelfTestVerdict {
  const limits = SEPARATION_SELF_TEST_LIMITS;
  const failed = (problem: Localized, facts: { vocals?: WavFacts; background?: WavFacts } = {}) => ({
    passed: false as const,
    problem: problem.text,
    problemRef: refOf(problem),
    ...facts,
  });
  const vocals = parseWav(stems.vocals);
  if (!vocals.ok) return failed(M.vocalsUndecodable({ problem: vocals.problem }));
  const background = parseWav(stems.background);
  if (!background.ok) return failed(M.backgroundUndecodable({ problem: background.problem }), { vocals: vocals.wav });
  const facts = { vocals: vocals.wav, background: background.wav };
  for (const [stem, wav] of [
    [M.vocals(), vocals.wav],
    [M.background(), background.wav],
  ] as const) {
    if (wav.channels !== 2) return failed(M.notStereo({ stem, channels: wav.channels }), facts);
    if (Math.abs(wav.durationSec - sampleDurationSec) > limits.durationToleranceSec) {
      return failed(
        M.durationMismatch({ stem, duration: wav.durationSec.toFixed(3), sample: sampleDurationSec.toFixed(3) }),
        facts,
      );
    }
  }
  if (vocals.wav.sampleRate !== background.wav.sampleRate) {
    return failed(M.sampleRateMismatch({ vocals: vocals.wav.sampleRate, background: background.wav.sampleRate }), facts);
  }
  if (vocals.wav.rms < limits.minVocalsRms) return failed(M.vocalsSilent(), facts);
  if (vocals.wav.rms < background.wav.rms * limits.minVocalsToBackground) {
    return failed(M.vocalsNotLouder({ vocals: vocals.wav.rms.toFixed(4), background: background.wav.rms.toFixed(4) }), facts);
  }
  return { passed: true, ...facts };
}
