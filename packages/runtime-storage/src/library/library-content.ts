import { VOICE_CONSENT_CUSTOM, type BrandMediaKind, type CaptionStyleBody, type GlossaryContent, type LibraryContentInput, type LibraryName, type TemplateLayers } from '@baocut/protocol';
import { formatInvalid } from './library-errors.ts';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';

/**
 * 条目内容的规范化与语义检查。RPC 的外形由协议的 zod 查过；交换文件导入不经 zod，所以这里自己把关，两条路得到同样的内容。
 */

export const MAX_NAME_CHARS = 200;
export const MAX_TERM_CHARS = 200;
export const MAX_TERMS = 5000;
export const MAX_MISHEARD_PER_TERM = 50;
export const MAX_NOTE_CHARS = 1000;
export const MAX_TRANSCRIPT_CHARS = 10_000;
export const MAX_STATEMENT_CHARS = 2000;
/** 自定义授权声明（`consentClip.language: 'custom'`）的那句话。 */
export const MAX_CONSENT_TEXT_CHARS = 500;
/** 音色的种子（与合成请求的 `seed` 同一范围）与每个音色最多记几个本机模型的种子。 */
export const MAX_SEED = 4_294_967_295;
export const MAX_VOICE_SEEDS = 50;
/** 字幕样式的上限，与 `setStyle` 的样式对象相同。 */
export const MAX_CAPTION_STYLE_BYTES = 64 * 1024;
/** 叠加模板定义的上限。 */
export const MAX_TEMPLATE_BYTES = 64 * 1024;

export const BRAND_MEDIA_KINDS: readonly BrandMediaKind[] = ['image', 'video', 'sticker', 'font'];

export function isBrandMediaKind(kind: string): kind is BrandMediaKind {
  return (BRAND_MEDIA_KINDS as readonly string[]).includes(kind);
}

function text(value: unknown, field: string, max: number, options: { allowEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') throw formatInvalid(SL.fieldNotText({ field }), { field });
  const trimmed = value.trim();
  if (!trimmed && !options.allowEmpty) throw formatInvalid(SL.fieldEmpty({ field }), { field });
  if ([...trimmed].length > max) throw formatInvalid(SL.fieldTooLong({ field, max }), { field });
  return trimmed;
}

/** 术语是一行文本：不能有换行。 */
function term(value: unknown, field: string): string {
  const t = text(value, field, MAX_TERM_CHARS);
  if (/[\r\n]/.test(t)) throw formatInvalid(SL.fieldNoNewline({ field }), { field });
  return t;
}

function languageOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return language(value, field);
}

function language(value: unknown, field: string): string {
  if (typeof value !== 'string') throw formatInvalid(SL.fieldNotLanguageTag({ field }), { field });
  try {
    const [canonical] = Intl.getCanonicalLocales(value.trim());
    if (canonical) return canonical;
  } catch {
    // 下面统一报错
  }
  throw formatInvalid(SL.fieldBadLanguageTag({ field, value }), { field });
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw formatInvalid(SL.fieldNotBoolean({ field }), { field });
  return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw formatInvalid(SL.fieldNotObject({ field }), { field });
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw formatInvalid(SL.fieldNotArray({ field }), { field });
  if (value.length > max) throw formatInvalid(SL.fieldTooMany({ field, max }), { field });
  return value;
}

/** 术语表：去掉首尾空白；误写去重并去掉与规范写法相同的；同一个规范写法（或源词）出现两次时拒绝。 */
export function normalizeGlossary(value: unknown): GlossaryContent {
  const v = object(value, 'content');
  const name = text(v.name, 'name', MAX_NAME_CHARS);
  const defaultEnabled = bool(v.defaultEnabled, 'defaultEnabled');
  if (v.kind === 'transcription') {
    const seen = new Set<string>();
    const terms = list(v.terms, 'terms', MAX_TERMS).map((raw, i) => {
      const t = object(raw, `terms[${i}]`);
      const canonical = term(t.canonical, `terms[${i}].canonical`);
      if (seen.has(canonical)) throw formatInvalid(SL.duplicateCanonical({ term: canonical }), { field: `terms[${i}].canonical` });
      seen.add(canonical);
      const misheard = [
        ...new Set(list(t.misheard, `terms[${i}].misheard`, MAX_MISHEARD_PER_TERM).map((m, j) => term(m, `terms[${i}].misheard[${j}]`))),
      ].filter((m) => m !== canonical);
      return { canonical, misheard };
    });
    return { name, kind: 'transcription', language: languageOrNull(v.language, 'language'), defaultEnabled, terms };
  }
  if (v.kind === 'translation') {
    const seen = new Set<string>();
    const terms = list(v.terms, 'terms', MAX_TERMS).map((raw, i) => {
      const t = object(raw, `terms[${i}]`);
      const source = term(t.source, `terms[${i}].source`);
      if (seen.has(source)) throw formatInvalid(SL.duplicateSource({ term: source }), { field: `terms[${i}].source` });
      seen.add(source);
      const note = t.note === null || t.note === undefined ? '' : text(t.note, `terms[${i}].note`, MAX_NOTE_CHARS, { allowEmpty: true });
      return { source, target: term(t.target, `terms[${i}].target`), note: note || null };
    });
    return {
      name,
      kind: 'translation',
      sourceLanguage: languageOrNull(v.sourceLanguage, 'sourceLanguage'),
      targetLanguage: language(v.targetLanguage, 'targetLanguage'),
      defaultEnabled,
      terms,
    };
  }
  throw formatInvalid(SL.glossaryKind(), { field: 'kind' });
}

/** 音色里由用户给的字段（参考录音与授权时间由库处理）。 */
export interface VoiceFields {
  name: string;
  language: string | null;
  transcript: string;
  origin: 'recorded' | 'imported';
  consent: { declared: boolean; statement: string | null };
  /** 授权声明录音念的是什么：`undefined` 没给（沿用当前的），`null` 去掉。录音文件由库处理。 */
  consentClip?: { language: string; text: string | null } | null;
  /** 没给时沿用当前的。 */
  seed?: number;
  seeds?: Record<string, number>;
}

function seedValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SEED) {
    throw formatInvalid(SL.fieldNotSeed({ field, max: MAX_SEED }), { field });
  }
  return value;
}

/** 授权声明录音的语言与文本：官方文本只记语言（BCP 47），`custom` 时记那句话。 */
function consentClipFields(value: unknown): { language: string; text: string | null } | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const clip = object(value, 'consentClip');
  if (clip.language === VOICE_CONSENT_CUSTOM) {
    return { language: VOICE_CONSENT_CUSTOM, text: text(clip.text, 'consentClip.text', MAX_CONSENT_TEXT_CHARS) };
  }
  return { language: language(clip.language, 'consentClip.language'), text: null };
}

function seedMap(value: unknown): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const map = object(value, 'seeds');
  const keys = Object.keys(map);
  if (keys.length > MAX_VOICE_SEEDS) throw formatInvalid(SL.fieldTooMany({ field: 'seeds', max: MAX_VOICE_SEEDS }), { field: 'seeds' });
  const out: Record<string, number> = {};
  for (const k of keys.sort()) {
    const modelId = k.trim();
    if (!modelId || [...modelId].length > MAX_NAME_CHARS) throw formatInvalid(SL.fieldEmpty({ field: 'seeds' }), { field: 'seeds' });
    out[modelId] = seedValue(map[k], `seeds.${modelId}`);
  }
  return out;
}

export function normalizeVoiceFields(value: unknown): VoiceFields {
  const v = object(value, 'content');
  if (v.origin !== 'recorded' && v.origin !== 'imported') throw formatInvalid(SL.voiceOrigin(), { field: 'origin' });
  const consent = object(v.consent, 'consent');
  const statement =
    consent.statement === null || consent.statement === undefined
      ? null
      : text(consent.statement, 'consent.statement', MAX_STATEMENT_CHARS, { allowEmpty: true }) || null;
  const fields: VoiceFields = {
    name: text(v.name, 'name', MAX_NAME_CHARS),
    language: languageOrNull(v.language, 'language'),
    transcript: text(v.transcript, 'transcript', MAX_TRANSCRIPT_CHARS, { allowEmpty: true }),
    origin: v.origin,
    consent: { declared: bool(consent.declared, 'consent.declared'), statement },
  };
  // 新字段没给时不出现在结果里：老条目的内容与摘要不变。
  const consentClip = consentClipFields(v.consentClip);
  if (consentClip !== undefined) fields.consentClip = consentClip;
  if (v.seed !== undefined) fields.seed = seedValue(v.seed, 'seed');
  const seeds = seedMap(v.seeds);
  if (seeds !== undefined) fields.seeds = seeds;
  return fields;
}

/** 品牌库不带文件的部分。带文件的种类只有名字。 */
export type BrandFields =
  | { name: string; kind: BrandMediaKind }
  | { name: string; kind: 'color'; value: string }
  | { name: string; kind: 'captionStyle'; style: CaptionStyleBody }
  | { name: string; kind: 'overlayTemplate'; template: TemplateLayers };

export function normalizeBrandFields(value: unknown): BrandFields {
  const v = object(value, 'content');
  const name = text(v.name, 'name', MAX_NAME_CHARS);
  if (typeof v.kind === 'string' && isBrandMediaKind(v.kind)) return { name, kind: v.kind };
  if (v.kind === 'color') {
    if (typeof v.value !== 'string' || !/^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(v.value)) {
      throw formatInvalid(SL.colorFormat(), { field: 'value' });
    }
    return { name, kind: 'color', value: v.value.toUpperCase() };
  }
  if (v.kind === 'captionStyle') {
    const style = object(v.style, 'style');
    if (typeof style.schema !== 'string' || !style.schema.trim()) {
      throw formatInvalid(SL.captionStyleSchema(), { field: 'style.schema' });
    }
    if (Buffer.byteLength(JSON.stringify(style)) > MAX_CAPTION_STYLE_BYTES) {
      throw formatInvalid(SL.captionStyleTooLarge({ kib: MAX_CAPTION_STYLE_BYTES / 1024 }), { field: 'style' });
    }
    return { name, kind: 'captionStyle', style: style as CaptionStyleBody };
  }
  if (v.kind === 'overlayTemplate') {
    // 只查外形与大小；图层的字段由编辑引擎在套用（`setTemplate`）时校验。
    const template = object(v.template, 'template');
    if (!Array.isArray(template.layers)) throw formatInvalid(SL.overlayTemplateShape(), { field: 'template.layers' });
    if (Buffer.byteLength(JSON.stringify(template)) > MAX_TEMPLATE_BYTES) {
      throw formatInvalid(SL.overlayTemplateTooLarge({ kib: MAX_TEMPLATE_BYTES / 1024 }), { field: 'template' });
    }
    return { name, kind: 'overlayTemplate', template: template as unknown as TemplateLayers };
  }
  throw formatInvalid(SL.brandKind(), { field: 'kind' });
}

/** 条目的显示名与种类（列表用）。 */
export function kindOf(library: LibraryName, content: LibraryContentInput): string {
  return library === 'voices' ? 'voice' : (content as { kind: string }).kind;
}
