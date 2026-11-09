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
import { providerCanClone, reseeded } from './voice-capture.ts';
import type { CloneFailureFacts } from './voice-clone-failure.ts';

export { VOICE_CLONE_PROVIDERS } from './voice-capture.ts';

/**
 * 模型 › 语音合成 › 我的声音的纯逻辑（架构设计 §5.9，设计稿 settings-voices.jsx）：一行音色怎么显示、各 Provider 上的克隆、
 * 新建与编辑的表单、删除前要先删哪些克隆、错误怎么说。命令在 components/models/voice-actions.ts。
 */

export type VoiceEntry = LibraryEntry<'voices'>;

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
  /** 克隆要附上说话人本人念授权声明的录音（`voiceClone.requiresConsentClip`）。 */
  requiresConsentClip: boolean;
  /** 这家收的样本时长（`voiceClone.sourceSeconds`）；没公开时 null。 */
  sourceSeconds: { min: number; max: number } | null;
}

/** 这个 Runtime 里能克隆（语音合成能力下报了 `voiceClone`）的 Provider。 */
export function cloneProviders(view: ModelCapabilitiesView | null): CloneProvider[] {
  return (view?.synthesizeSpeech.providers ?? []).filter(providerCanClone).map((p) => ({
    providerId: p.providerId,
    label: p.label,
    available: p.available,
    detail: p.available ? null : (localizeText(p.detail, p.detailRef) ?? null),
    requiresConsentClip: !!p.voiceClone?.requiresConsentClip,
    sourceSeconds: p.voiceClone?.sourceSeconds ? { ...p.voiceClone.sourceSeconds } : null,
  }));
}

/**
 * 这次运行里界面发起的一次上传（state/voice-clone-store.ts 记着）：`submitted` 拿到了任务 ID，任务经 `jobs` 主题送回来之前
 * 也算在跑；`rejected` 提交时就被拒（没建任务），比这家最近一次任务新时当作这次的失败。`at` 是 `Date.now()`。
 */
export type CloneAttempt = { kind: 'submitted'; jobId: string; at: number } | { kind: 'rejected'; error: unknown; at: number };

export const cloneAttemptKey = (voiceId: string, providerId: string): string => `${voiceId}\n${providerId}`;

/** 提交了、任务还没送回来：最多这么久还当它在跑（主题断了、任务被清掉时不一直转）。 */
const PENDING_MS = 30_000;

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
  /** 最近一次克隆没建成（之后也没有建成）：诊断用的事实（voice-clone-failure.ts 写成原因与补救）。 */
  failure: CloneFailureFacts | null;
  /** 「上传到 X」能不能点；不能时 `why` 说原因。有效的克隆不再给这一项。 */
  create: { enabled: boolean; why: string | null } | null;
  /** 有克隆记录（有效或过期）时可以删。 */
  removable: boolean;
}

function num(details: unknown, key: string): number | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

type FailureContext = Pick<CloneFailureFacts, 'providerId' | 'label' | 'sourceSeconds' | 'hasConsentClip'>;

/** 克隆任务失败（`job.error`）→ 诊断用的事实。 */
export function jobCloneFailure(error: NonNullable<JobRecord['error']>, context: FailureContext): CloneFailureFacts {
  const details = error.details;
  return {
    ...context,
    code: error.code ?? null,
    reason: str(details, 'reason'),
    status: num(details, 'status'),
    message: jobErrorText(error),
    remedy: remedyHint(details),
  };
}

/** `library.createVoiceClone` 提交时就被拒（RpcError，错误码在 `details.code`）→ 诊断用的事实。 */
export function rpcCloneFailure(error: unknown, context: FailureContext): CloneFailureFacts {
  const ref = (error as { messageRef?: MessageRef } | null)?.messageRef;
  const details = (error as { details?: unknown } | null)?.details;
  return {
    ...context,
    code: str(details, 'code'),
    reason: str(details, 'reason'),
    status: num(details, 'status'),
    message: localizeText(error instanceof Error ? error.message : String(error), ref),
    remedy: remedyHint(details),
  };
}

/**
 * 一只音色在各个能克隆的 Provider 上的状态；条目里记着、但这个 Runtime 已经不登记的 Provider 也列出来，好让人删掉。
 * `attempts` 是这次运行里界面发起的上传（`cloneAttemptKey` 为键）：刚提交、任务还没送回来时也算在跑；提交时就被拒的当作失败。
 */
export function cloneRows(
  voice: LibraryEntrySummary,
  providers: readonly CloneProvider[],
  jobs: readonly JobRecord[],
  attempts: Readonly<Record<string, CloneAttempt>> = {},
  now = Date.now(),
): CloneRow[] {
  const ids = [...providers.map((p) => p.providerId)];
  for (const c of voice.clones ?? []) if (!ids.includes(c.providerId)) ids.push(c.providerId);
  return ids.map((providerId) => {
    const provider = providers.find((p) => p.providerId === providerId) ?? null;
    const label = provider?.label ?? providerId;
    const state = voice.clones?.find((c) => c.providerId === providerId)?.state ?? 'none';
    const job = latestCloneJob(jobs, voice.id, providerId);
    const attempt = attempts[cloneAttemptKey(voice.id, providerId)] ?? null;
    const pending = attempt?.kind === 'submitted' && now - attempt.at < PENDING_MS && !jobs.some((j) => j.jobId === attempt.jobId);
    const running = pending || (!!job && LIVE.includes(job.state));
    const context: FailureContext = { providerId, label, sourceSeconds: provider?.sourceSeconds ?? null, hasConsentClip: !!voice.consentClip };
    const rejected = attempt?.kind === 'rejected' && (!job || Date.parse(job.createdAt) < attempt.at) ? attempt : null;
    const failure =
      state === 'valid' || running
        ? null
        : rejected
          ? rpcCloneFailure(rejected.error, context)
          : job?.state === 'failed' && job.error
            ? jobCloneFailure(job.error, context)
            : null;
    let create: CloneRow['create'] = null;
    if (state !== 'valid') {
      const why = running
        ? M.uploading(label)
        : !voice.consentDeclared
          ? M.noConsent
          : provider?.requiresConsentClip && !voice.consentClip
            ? M.noConsentClip(label)
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

/**
 * 从模型页过来、存好之后，回程条说什么：`saved` 不是从某家云端过来（本机模型或没指定）；云端那家 `uploading` 在传、
 * `ready` 建好了、`failed` 没建成、`not-uploaded` 这次没上传（没连上、跳过了授权声明、没选它）。
 */
export type HandoffOutcome = 'saved' | 'uploading' | 'ready' | 'failed' | 'not-uploaded';

export function handoffOutcome(target: { kind: 'local' | 'cloud'; id: string } | undefined, rows: readonly CloneRow[]): HandoffOutcome {
  if (target?.kind !== 'cloud') return 'saved';
  const row = rows.find((r) => r.providerId === target.id);
  if (!row) return 'not-uploaded';
  if (row.running) return 'uploading';
  if (row.state === 'valid') return 'ready';
  return row.failure ? 'failed' : 'not-uploaded';
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

/** 克隆新音色存下时的一份（我的声音 › 克隆新音色）：样本与授权声明录音都已经写成本机的 WAV。 */
export interface CapturedVoice {
  name: string;
  /** 样本的语言（照着念的台词的语言，或上传时选的）；BCP 47。 */
  language: string | null;
  /** 麦克风录的：照着念的台词；上传的：空。 */
  transcript: string;
  origin: VoiceContent['origin'];
  consent: boolean;
  /** 每只本机引擎一颗种子；空时不写。 */
  seeds: Record<string, number>;
  samplePath: string;
  /** 授权声明录音；跳过时 null。 */
  consentClip: { language: string; text: string | null; path: string } | null;
}

/** 克隆新音色 → `library.put`：样本是参考录音，授权声明录音经 `consentSource` 一起交上去。 */
export function captureVoiceRequest(v: CapturedVoice): Omit<LibraryPutParams, 'commandId'> {
  const form: VoiceForm = { name: v.name, language: v.language ?? '', transcript: v.transcript, consent: v.consent };
  const content = voiceContentInput(form, v.origin, null);
  return {
    library: 'voices',
    content: {
      ...content,
      ...(Object.keys(v.seeds).length ? { seeds: { ...v.seeds } } : {}),
      ...(v.consentClip ? { consentClip: { language: v.consentClip.language, text: v.consentClip.text } } : {}),
    } as LibraryPutParams['content'],
    source: { path: v.samplePath },
    ...(v.consentClip ? { consentSource: { path: v.consentClip.path } } : {}),
  };
}

/** 给已有音色补录 / 重录授权声明：别的不动，带上版本号。 */
export function consentClipRequest(
  entry: VoiceEntry,
  clip: { language: string; text: string | null; path: string },
): Omit<LibraryPutParams, 'commandId'> {
  const base = editVoiceRequest(formFromEntry(entry), entry);
  return {
    ...base,
    content: { ...base.content, consentClip: { language: clip.language, text: clip.text } } as LibraryPutParams['content'],
    consentSource: { path: clip.path },
  };
}

/** 换一颗种子：`modelId` 为 `*` 时换兜底的 `seed`，否则换这只引擎的；别的种子照旧。 */
export function reseedRequest(entry: VoiceEntry, modelId: string, seed: number): Omit<LibraryPutParams, 'commandId'> {
  const base = editVoiceRequest(formFromEntry(entry), entry);
  return { ...base, content: { ...base.content, ...reseeded(entry.content, modelId, seed) } as LibraryPutParams['content'] };
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
    case 'VOICE_CONSENT_CLIP_REQUIRED':
      return add(M.remedyConsentClip);
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
