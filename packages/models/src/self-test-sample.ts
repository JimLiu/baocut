import { modelAssetPath } from './model-assets.ts';

/**
 * 模型包自检（`models.test`，架构设计 §6.3）用的固定样本：一段随附的英文朗读（约 3.7 秒，16 kHz 单声道 WAV），
 * 与 Model Worker 的集成测试用的是同一个文件。自检走一遍完整的 Worker 流程，结果要合 `baocut.asr-result/v1`，
 * 并且识别出的文字（忽略大小写与标点，英文的个位数词与数字视作相同）包含 `expected`。
 */
export interface SelfTestSample {
  /** 模型数据目录里的相对路径（`model-assets.ts`）；绝对路径用 `selfTestSampleFile` 在用时求。 */
  asset: string;
  /** 识别结果必须包含的文字（小写、单词以空格分隔）。 */
  expected: string;
  /** 样本的语言（以「偏好」交给 Worker，不断言）。 */
  language: string;
}

export const TRANSCRIBE_SELF_TEST: SelfTestSample = {
  asset: 'self-test-sample.wav',
  expected: 'testing one two three',
  language: 'en',
};

/** 样本的绝对路径；找不到模型数据目录时 null（读的地方报 `APP_FILE_MISSING`）。 */
export function selfTestSampleFile(sample: SelfTestSample, env: NodeJS.ProcessEnv = process.env): string | null {
  return modelAssetPath(sample.asset, env);
}

/** 把识别出的文字规整成小写、单词以一个空格分隔。 */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** 规整后再把英文的个位数词换成数字：有的模型（Whisper）把「one two three」写成「1, 2, 3」。 */
function withDigits(text: string): string {
  return normalizeTranscript(text)
    .split(' ')
    .map((word) => DIGIT_WORDS[word] ?? word)
    .join(' ');
}

/** 识别结果是否包含样本的期望文字（数字写成阿拉伯数字也算）。 */
export function selfTestMatches(text: string, sample: SelfTestSample): boolean {
  return ` ${withDigits(text)} `.includes(` ${withDigits(sample.expected)} `);
}
