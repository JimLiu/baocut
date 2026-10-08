import {
  localizeText,
  type JobRecord,
  type LibraryEntry,
  type LibraryEntrySummary,
  type LibraryPutParams,
  type MessageRef,
  type ModelCapabilitiesView,
  type VoiceContent,
} from '@baocut/protocol';
import { agoLabel } from './format.ts';
import type { ModelChip } from './models-local.ts';
import { fmtSize } from './task-facts.ts';
import { langName, languageOptions, type LanguageOption } from './tools-models.ts';
import { M } from './voices-library-copy.ts';
import { jobErrorText, remedyHintText, remedyText } from './localized-text.ts';

/**
 * 模型 › 语音合成 › 我的声音的纯逻辑（架构设计 §5.9，设计稿 settings-voices.jsx）：一行音色怎么显示、各 Provider 上的克隆、
 * 新建与编辑的表单、删除前要先删哪些克隆、错误怎么说。命令在 components/models/voice-actions.ts。
 */

export type VoiceEntry = LibraryEntry<'voices'>;

/** 能建克隆的 Provider：Runtime 现在只有 ElevenLabs 有克隆接口，别的以 `VOICE_CLONE_UNSUPPORTED` 拒绝。 */
export const VOICE_CLONE_PROVIDERS: readonly string[] = ['elevenlabs'];
/** 勾上「本人声明」时写进 `consent.statement` 的话（按当前界面语言；存下后原话不变）。 */
export function voiceConsentStatement(): string {
  return M.consentStatement;
}
/** 参考录音只收这三种（Runtime 按文件头认，再用 ffprobe 解一遍）。 */
export const VOICE_AUDIO_EXTENSIONS: readonly string[] = ['wav', 'mp3', 'flac'];
export const VOICE_PACKAGE_EXTENSION = 'bcvoice';
export const VOICE_NAME_MAX = 200;
export const VOICE_TRANSCRIPT_MAX = 10_000;

const chars = (s: string) => [...s].length;

// ---- 克隆 ----

export interface CloneProvider {
  providerId: string;
  label: string;
  available: boolean;
  /** 不可用时 Runtime 给的说明（没有启用、没有设置密钥……）。 */
  detail: string | null;
}

/** 这个 Runtime 里能克隆、且在语音合成能力下登记了的 Provider。 */
export function cloneProviders(view: ModelCapabilitiesView | null): CloneProvider[] {
  const providers = view?.synthesizeSpeech.providers ?? [];
  return VOICE_CLONE_PROVIDERS.flatMap((providerId) => {
    const p = providers.find((x) => x.providerId === providerId);
    if (!p) return [];
    return [{ providerId, label: p.label, available: p.available, detail: p.available ? null : (localizeText(p.detail, p.detailRef) ?? null) }];
  });
}

const LIVE: readonly JobRecord['state'][] = ['queued', 'running'];

/** 这只音色在这个 Provider 上最近一次克隆任务。 */
export function latestCloneJob(jobs: readonly JobRecord[], voiceId: string, providerId: string): JobRecord | null {
  let latest: JobRecord | null = null;
  for (const job of jobs) {
    if (job.kind !== 'voiceClone' || job.providerId !== providerId || job.library?.entries[0]?.id !== voiceId) continue;
    if (!latest || job.createdAt > latest.createdAt) latest = job;
  }
  return latest;
}

export interface CloneRow {
  providerId: string;
  label: string;
  /** `none`：这个 Provider 上还没有克隆。 */
  state: 'valid' | 'stale' | 'none';
  running: boolean;
  /** 最近一次克隆失败的原因（之后没有建成）。 */
  failure: string | null;
  /** 「上传到 X」能不能点；不能时 `why` 说原因。有效的克隆不再给这一项。 */
  create: { enabled: boolean; why: string | null } | null;
  /** 有克隆记录（有效或过期）时可以删。 */
  removable: boolean;
}

/** 一只音色在各个能克隆的 Provider 上的状态；条目里记着、但这个 Runtime 已经不登记的 Provider 也列出来，好让人删掉。 */
export function cloneRows(voice: LibraryEntrySummary, providers: readonly CloneProvider[], jobs: readonly JobRecord[]): CloneRow[] {
  const ids = [...providers.map((p) => p.providerId)];
  for (const c of voice.clones ?? []) if (!ids.includes(c.providerId)) ids.push(c.providerId);
  return ids.map((providerId) => {
    const provider = providers.find((p) => p.providerId === providerId) ?? null;
    const label = provider?.label ?? providerId;
    const state = voice.clones?.find((c) => c.providerId === providerId)?.state ?? 'none';
    const job = latestCloneJob(jobs, voice.id, providerId);
    const running = !!job && LIVE.includes(job.state);
    const failure = job?.state === 'failed' && state !== 'valid' && job.error ? errorText(job.error.code, jobErrorText(job.error), job.error.details) : null;
    let create: CloneRow['create'] = null;
    if (state !== 'valid') {
      const why = running
        ? M.uploading(label)
        : !voice.consentDeclared
          ? M.noConsent
          : !provider
            ? M.cannotClone(label)
            : !provider.available
              ? M.providerOff(label, provider.detail)
              : null;
      create = { enabled: why === null, why };
    }
    return { providerId, label, state, running, failure, create, removable: state !== 'none' && !running };
  });
}

// ---- 一行的显示 ----

/** 名字旁边的标签：没有本人声明、各 Provider 上的克隆。 */
export function voiceChips(voice: LibraryEntrySummary, providers: readonly CloneProvider[]): ModelChip[] {
  const chips: ModelChip[] = [];
  if (!voice.consentDeclared) chips.push({ label: M.consentUnstated, tone: 'neutral' });
  for (const clone of voice.clones ?? []) {
    const label = providers.find((p) => p.providerId === clone.providerId)?.label ?? clone.providerId;
    chips.push(clone.state === 'valid' ? { label: M.cloned(label), tone: 'positive' } : { label: M.cloneStale(label), tone: 'notice' });
  }
  return chips;
}

const FORMAT: Record<string, string> = { 'audio/wav': 'WAV', 'audio/mpeg': 'MP3', 'audio/flac': 'FLAC' };

/** 名字下面的一行：语言 · 录音格式与大小 · 来源 · 什么时候改的。 */
export function voiceMeta(entry: VoiceEntry, now = Date.now()): string {
  const c = entry.content;
  const parts = [
    c.language ? langName(c.language) : M.languageUnknown,
    `${FORMAT[c.reference.mediaType] ?? c.reference.mediaType} ${fmtSize(c.reference.byteLength)}`,
    c.origin === 'recorded' ? M.recorded : M.imported,
    M.edited(agoLabel(entry.updatedAt, now)),
  ];
  return parts.join(' · ');
}

// ---- 新建与编辑 ----

export interface VoiceForm {
  name: string;
  /** BCP 47；空串 = 不知道。 */
  language: string;
  transcript: string;
  consent: boolean;
}

export interface VoiceFormErrors {
  name: string | null;
  transcript: string | null;
}

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** 从文件新建：名字先用文件名（不带扩展名）。 */
export function formForFile(path: string): VoiceForm {
  return { name: [...baseName(path).trim()].slice(0, VOICE_NAME_MAX).join(''), language: '', transcript: '', consent: false };
}

export function formFromEntry(entry: VoiceEntry): VoiceForm {
  const c = entry.content;
  return { name: c.name, language: c.language ?? '', transcript: c.transcript, consent: c.consent.declared };
}

export function validateVoiceForm(form: VoiceForm): VoiceFormErrors {
  const name = form.name.trim();
  return {
    name: !name ? M.nameRequired : chars(name) > VOICE_NAME_MAX ? M.nameTooLong(VOICE_NAME_MAX) : null,
    transcript: chars(form.transcript.trim()) > VOICE_TRANSCRIPT_MAX ? M.transcriptTooLong(VOICE_TRANSCRIPT_MAX) : null,
  };
}

export function formValid(form: VoiceForm): boolean {
  const errors = validateVoiceForm(form);
  return !errors.name && !errors.transcript;
}

/** 语言下拉：不知道 + 常用语言；条目里的语言不在常用里时也列出来。 */
export function voiceLanguageOptions(current: string): LanguageOption[] {
  const options = languageOptions('any', M.dontKnow);
  if (current && !options.some((o) => o.key === current)) options.push({ key: current, label: langName(current) });
  return options;
}

/**
 * 表单 → `library.put` 的内容。授权声明：勾着时沿用条目里原有的那句（声明的原话不变，Runtime 才保留原来的声明时间），
 * 没有原话时用固定的一句；不勾时撤销声明。
 */
export function voiceContentInput(form: VoiceForm, origin: VoiceContent['origin'], previous: VoiceContent | null): LibraryPutParams['content'] {
  const kept = previous?.consent.declared && previous.consent.statement ? previous.consent.statement : null;
  return {
    name: form.name.trim(),
    language: form.language || null,
    transcript: form.transcript.trim(),
    origin,
    consent: form.consent ? { declared: true, statement: kept ?? M.consentStatement } : { declared: false, statement: null },
  };
}

/** 从一个音频文件新建一只音色（参考录音由 Runtime 从这个路径拷进库里）。 */
export function createVoiceRequest(form: VoiceForm, path: string): Omit<LibraryPutParams, 'commandId'> {
  return { library: 'voices', content: voiceContentInput(form, 'imported', null), source: { path } };
}

/** 改名字、语言、逐字稿或声明：不给 `source`，沿用原来的录音；带上版本号，别处先改了时被拒。 */
export function editVoiceRequest(form: VoiceForm, entry: VoiceEntry): Omit<LibraryPutParams, 'commandId'> {
  return {
    library: 'voices',
    id: entry.id,
    expectedVersion: entry.version,
    content: voiceContentInput(form, entry.content.origin, entry.content),
  };
}

/** 选音频文件时的粗筛（按扩展名）；真正的判断在 Runtime。 */
export function isVoiceAudioPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return VOICE_AUDIO_EXTENSIONS.includes(ext);
}

/** 导出音色包的默认文件名：`名字.bcvoice`，去掉文件名里不能用的字符。 */
export function voicePackageName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = [...name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')]
    .slice(0, 100)
    .join('')
    .trim();
  return `${cleaned || 'voice'}.${VOICE_PACKAGE_EXTENSION}`;
}

// ---- 删除 ----

/** 删除一只音色前要先删掉的克隆（有效的与过期的都删：只删条目会在供应商那边留下克隆，界面上却再也找不到它）。 */
export function clonesToRemove(voice: LibraryEntrySummary): string[] {
  return (voice.clones ?? []).map((c) => c.providerId);
}

export function deleteBody(voice: LibraryEntrySummary, providers: readonly CloneProvider[]): string {
  const labels = clonesToRemove(voice).map((id) => providers.find((p) => p.providerId === id)?.label ?? id);
  return M.deleteBody(labels.length ? M.deleteClones(labels) : '');
}

/** 上传前的告知（设计稿的 uploadNotice；这里没有录音时长，给的是大小）。 */
export function uploadNotice(voice: LibraryEntrySummary, label: string, entry: VoiceEntry | null): string {
  return M.uploadNotice(voice.name, entry ? fmtSize(entry.content.reference.byteLength) : null, label);
}

// ---- 错误 ----

function str(details: unknown, key: string): string | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && v ? v : null;
}

function remedyHint(details: unknown): string | null {
  return remedyText(details) ?? remedyHintText((details as { remedy?: unknown } | null | undefined)?.remedy);
}

/** 按错误码补一句怎么办（音色的保存、导入导出、克隆与删除）。 */
export function errorText(code: string | null, message: string, details: unknown): string {
  const add = (remedy: string | null) => (remedy ? M.withRemedy(message, remedy) : message);
  switch (code) {
    case 'VOICE_CONSENT_REQUIRED':
      return add(M.remedyConsent);
    case 'CAPABILITY_NOT_CONFIGURED':
      return add(M.remedyConfigure);
    case 'LIBRARY_VERSION_CONFLICT':
      return add(M.remedyConflict);
    case 'GRANT_REQUIRED':
    case 'GRANT_REVOKED':
    case 'BUDGET_EXCEEDED':
      return add(remedyHint(details) ?? M.remedyGrant);
    default:
      return add(remedyHint(details));
  }
}

/** RPC 被拒时的一句话（错误码在 `details.code`）。 */
export function rpcErrorText(error: unknown): string {
  // RpcError 带 `messageRef` 时按当前界面语言重新生成。
  const ref = (error as { messageRef?: MessageRef } | null)?.messageRef;
  const message = localizeText(error instanceof Error ? error.message : String(error), ref);
  const details = (error as { details?: unknown } | null)?.details;
  return errorText(str(details, 'code'), message, details);
}

/** 错误码（`details.code`）。 */
export function errorCode(error: unknown): string | null {
  return str((error as { details?: unknown } | null)?.details, 'code');
}
