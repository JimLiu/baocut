import { refOf, type Localized, type MessageRef, type SynthesizeSpeechRequest } from '@baocut/protocol';
import { ModelsSpeechSelfTest as M } from '@baocut/protocol/messages/models/speech-self-test.ts';
import type { BundleDefinition } from './bundle-registry.ts';

/**
 * 本地语音合成模型包的自检（架构设计 §6.3，Model Worker 协议规范 §4.3）：用模型自己的默认声音合成一句固定的短句，
 * 检查输出是能解码的 WAV、时长合理、不是静音、没有削波。不判断读得对不对（那要另一个识别模型），只证明整条合成链路能出声。
 */

/** 每种语言一句（按 BCP 47 主语言子标签）。模型不列出这些语言、或接受任意语言时用英文那句。 */
export const SPEECH_SELF_TEST_SENTENCES: Readonly<Record<string, string>> = {
  // i18n-ignore-start: 自检朗读样本（交给模型合成的固定句子，按语言各一句）
  zh: '这是一段语音合成的自检。',
  en: 'This is a short speech synthesis check.',
  ja: 'これは音声合成の短いテストです。',
  ko: '이것은 음성 합성 점검입니다.',
  es: 'Esta es una breve prueba de síntesis de voz.',
  fr: 'Ceci est un court test de synthèse vocale.',
  de: 'Dies ist ein kurzer Test der Sprachsynthese.',
  it: 'Questa è una breve prova di sintesi vocale.',
  pt: 'Este é um breve teste de síntese de voz.',
  ru: 'Это короткая проверка синтеза речи.',
  ar: 'هذا اختبار قصير لتوليد الكلام.',
  // i18n-ignore-end
};
const FALLBACK_LANGUAGE = 'en';

/** 判定的阈值（写在 Model Worker 协议规范 §4.3）。 */
export const SPEECH_SELF_TEST_LIMITS = {
  /** 一句短句合成出的时长下限与上限（秒）。 */
  minDurationSec: 0.3,
  maxDurationSec: 30,
  /** 整段的均方根（满幅为 1）低于这个值就当作静音（约 -60 dBFS）。 */
  minRms: 0.001,
  /** 到了满幅（|x| ≥ `clipLevel`）的样本占全部样本的比例高于这个值就当作削波。 */
  clipLevel: 0.999,
  maxClippedRatio: 0.001,
} as const;

/** 自检的请求：模型列出的第一种有句子的语言；接受任意语言或都没有句子时用英文。声音用模型的默认声音（不指定）。 */
export function speechSelfTestRequest(def: BundleDefinition): SynthesizeSpeechRequest & { language: string } {
  const listed = def.speech?.languages;
  const language =
    listed && listed !== 'any'
      ? (listed.find((l) => SPEECH_SELF_TEST_SENTENCES[l.toLowerCase().split('-')[0]!]) ?? FALLBACK_LANGUAGE)
      : FALLBACK_LANGUAGE;
  const primary = language.toLowerCase().split('-')[0]!;
  return { text: SPEECH_SELF_TEST_SENTENCES[primary] ?? SPEECH_SELF_TEST_SENTENCES[FALLBACK_LANGUAGE]!, language };
}

export interface WavFacts {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** `pcm`：整数 PCM；`float`：IEEE 浮点。 */
  encoding: 'pcm' | 'float';
  durationSec: number;
  /** 所有声道合在一起的均方根，满幅为 1。 */
  rms: number;
  /** 所有样本里的最大绝对值，满幅为 1。 */
  peak: number;
  /** 到了满幅（|x| ≥ 0.999）的样本占全部样本的比例。 */
  clippedRatio: number;
}

/** 解析 WAV（RIFF/WAVE，PCM 16/24/32 位或 32 位浮点）：不合格式时给出原因。 */
export function inspectWav(bytes: Buffer): { ok: true; wav: WavFacts } | { ok: false; problem: string } {
  const parsed = parseWav(bytes);
  return parsed.ok ? parsed : { ok: false, problem: parsed.problem.text };
}

/** 同 `inspectWav`，原因带消息引用（嵌进自检判定的句子里）。 */
export function parseWav(bytes: Buffer): { ok: true; wav: WavFacts } | { ok: false; problem: Localized } {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, problem: M.notWav() };
  }
  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: { start: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      let format = bytes.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE：真正的格式在子格式 GUID 的前两个字节。
      if (format === 0xfffe && size >= 40 && body + 26 <= bytes.length) format = bytes.readUInt16LE(body + 24);
      fmt = {
        format,
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bitsPerSample: bytes.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { start: body, length: Math.min(size, bytes.length - body) };
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt) return { ok: false, problem: M.missingFmt() };
  if (!data) return { ok: false, problem: M.missingData() };
  const { format, channels, sampleRate, bitsPerSample } = fmt;
  const encoding = format === 1 ? 'pcm' : format === 3 ? 'float' : null;
  if (!encoding) return { ok: false, problem: M.unsupportedEncoding({ format }) };
  if (channels < 1 || channels > 2) return { ok: false, problem: M.badChannels({ channels }) };
  if (sampleRate < 8_000 || sampleRate > 192_000) return { ok: false, problem: M.badSampleRate({ sampleRate }) };
  const valid = encoding === 'float' ? bitsPerSample === 32 : bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32;
  if (!valid) return { ok: false, problem: M.unsupportedBitDepth({ bits: bitsPerSample }) };
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.floor(data.length / bytesPerSample);
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples; i++) {
    const at = data.start + i * bytesPerSample;
    let value: number;
    if (encoding === 'float') value = bytes.readFloatLE(at);
    else if (bitsPerSample === 16) value = bytes.readInt16LE(at) / 32_768;
    else if (bitsPerSample === 24) value = bytes.readIntLE(at, 3) / 8_388_608;
    else value = bytes.readInt32LE(at) / 2_147_483_648;
    if (!Number.isFinite(value)) return { ok: false, problem: M.nonFinite() };
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= SPEECH_SELF_TEST_LIMITS.clipLevel) clipped++;
  }
  const frames = Math.floor(samples / channels);
  return {
    ok: true,
    wav: {
      sampleRate,
      channels,
      bitsPerSample,
      encoding,
      durationSec: frames / sampleRate,
      rms: samples > 0 ? Math.sqrt(sum / samples) : 0,
      peak,
      clippedRatio: samples > 0 ? clipped / samples : 0,
    },
  };
}

/**
 * 自检的判定：能解码、时长在范围内、不是静音、没有削波。不通过时给出原因：`problem` 是当前语言的文本，`problemRef` 是它的
 * 消息引用（记进检查结果的 `detailRef`、任务错误的 `messageRef`）。
 */
export function speechSelfTestVerdict(
  bytes: Buffer,
): { passed: true; wav: WavFacts } | { passed: false; problem: string; problemRef?: MessageRef; wav?: WavFacts } {
  const failed = (problem: Localized, wav?: WavFacts) => ({
    passed: false as const,
    problem: problem.text,
    problemRef: refOf(problem),
    ...(wav ? { wav } : {}),
  });
  const parsed = parseWav(bytes);
  if (!parsed.ok) return failed(M.undecodable({ problem: parsed.problem }));
  const { wav } = parsed;
  const limits = SPEECH_SELF_TEST_LIMITS;
  if (wav.durationSec < limits.minDurationSec || wav.durationSec > limits.maxDurationSec) {
    return failed(
      M.durationOutOfRange({ duration: wav.durationSec.toFixed(2), min: limits.minDurationSec, max: limits.maxDurationSec }),
      wav,
    );
  }
  if (wav.rms < limits.minRms) return failed(M.silent(), wav);
  if (wav.clippedRatio > limits.maxClippedRatio) {
    return failed(M.clipped({ ratio: (wav.clippedRatio * 100).toFixed(2), limit: limits.maxClippedRatio * 100 }), wav);
  }
  return { passed: true, wav };
}
