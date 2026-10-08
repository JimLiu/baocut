import type { VoiceContent } from '@baocut/protocol';
import { sha256Hex } from './content-hash.ts';
import { normalizeVoiceFields, type VoiceFields } from './library-content.ts';
import { formatInvalid } from './library-errors.ts';
import { sniffBytes, VOICE_AUDIO_TYPES } from './media-sniff.ts';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';

/**
 * 音色包 `.bcvoice`（架构设计 §5.9）：一个 UTF-8 的 JSON 文件，参考录音以 base64 内嵌。
 *
 * ```json
 * {
 *   "format": "baocut.voice-package",
 *   "version": 1,
 *   "name": "我的声音",
 *   "language": "zh-CN",            // 可为 null
 *   "transcript": "参考录音的逐字稿",
 *   "origin": "recorded",           // 或 imported
 *   "consent": { "declared": true, "declaredAt": "2026-…Z", "statement": "…" },
 *   "reference": { "fileName": "ref.wav", "mediaType": "audio/wav", "sha256": "sha256:<hex>", "byteLength": 123, "data": "<base64>" }
 * }
 * ```
 *
 * - 只包含声音本身与授权声明；各 Provider 上的克隆不导出（换一台机器、换一个账号都要重新克隆）。
 * - 校验：`format` 与 `version`；字段的类型与长度；整个文件 ≤ 32 MiB，录音 ≤ 20 MiB；base64 解出的字节数与摘要和声明一致；
 *   文件头是 wav、mp3 或 flac，且与 `mediaType` 一致；最后由 Runtime 用 ffprobe 解码一遍（库里的 `validateAudio`）。
 */

export const VOICE_PACKAGE_FORMAT = 'baocut.voice-package';
export const VOICE_PACKAGE_VERSION = 1;
export const VOICE_PACKAGE_MAX_BYTES = 32 * 1024 * 1024;
export const VOICE_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;

export interface DecodedVoicePackage {
  fields: VoiceFields;
  /** 包里记的授权时间；导入时沿用。 */
  declaredAt: string | null;
  reference: { bytes: Buffer; fileName: string; mediaType: string };
}

export function encodeVoicePackage(content: VoiceContent, reference: Buffer): string {
  return `${JSON.stringify(
    {
      format: VOICE_PACKAGE_FORMAT,
      version: VOICE_PACKAGE_VERSION,
      name: content.name,
      language: content.language,
      transcript: content.transcript,
      origin: content.origin,
      consent: content.consent,
      reference: {
        fileName: content.reference.fileName,
        mediaType: content.reference.mediaType,
        sha256: content.reference.sha256,
        byteLength: content.reference.byteLength,
        data: reference.toString('base64'),
      },
    },
    null,
    2,
  )}\n`;
}

/** `value` 是解析过的 JSON。 */
export function decodeVoicePackage(value: unknown): DecodedVoicePackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw formatInvalid(SL.voicePackageNotObject());
  const v = value as Record<string, unknown>;
  if (v.format !== VOICE_PACKAGE_FORMAT) throw formatInvalid(SL.voicePackageFormat({ format: VOICE_PACKAGE_FORMAT }));
  if (v.version !== VOICE_PACKAGE_VERSION) throw formatInvalid(SL.voicePackageVersion({ version: String(v.version), supported: VOICE_PACKAGE_VERSION }));
  const fields = normalizeVoiceFields(v);
  const consent = v.consent as Record<string, unknown>;
  const declaredAt =
    fields.consent.declared && typeof consent.declaredAt === 'string' && !Number.isNaN(Date.parse(consent.declaredAt))
      ? new Date(consent.declaredAt).toISOString()
      : null;

  const ref = v.reference;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw formatInvalid(SL.voicePackageNoReference());
  const r = ref as Record<string, unknown>;
  if (typeof r.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) throw formatInvalid(SL.referenceDataBase64());
  if (
    typeof r.byteLength !== 'number' ||
    !Number.isInteger(r.byteLength) ||
    r.byteLength <= 0 ||
    r.byteLength > VOICE_REFERENCE_MAX_BYTES
  ) {
    throw formatInvalid(SL.referenceByteLength({ max: VOICE_REFERENCE_MAX_BYTES }));
  }
  const bytes = Buffer.from(r.data, 'base64');
  if (bytes.length !== r.byteLength) throw formatInvalid(SL.referenceLengthMismatch({ actual: bytes.length, declared: r.byteLength }));
  if (typeof r.sha256 !== 'string' || r.sha256 !== `sha256:${sha256Hex(bytes)}`) throw formatInvalid(SL.referenceDigestMismatch());
  const sniffed = sniffBytes(bytes.subarray(0, 64));
  if (!sniffed || !VOICE_AUDIO_TYPES.includes(sniffed.mediaType)) throw formatInvalid(SL.referenceAudioType());
  if (r.mediaType !== sniffed.mediaType)
    throw formatInvalid(SL.referenceTypeMismatch({ sniffed: sniffed.mediaType, declared: String(r.mediaType) }));
  const fileName = typeof r.fileName === 'string' && r.fileName.trim() ? safeFileName(r.fileName) : `reference.${sniffed.ext}`;
  return { fields, declaredAt, reference: { bytes, fileName, mediaType: sniffed.mediaType } };
}

/** 只留文件名本身：去掉目录与控制字符。 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim();
  return [...cleaned].slice(0, 200).join('') || 'file';
}
