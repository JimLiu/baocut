import { LINK_COOKIE_BROWSERS, live, localizeToolStatus, type ExternalToolStatus, type JobError, type JobRecord, type LinkCookieBrowser, type LinkImportSummary } from '@baocut/protocol';
import { shortenPath } from './format.ts';
import { M } from './link-import-copy.ts';
import { formatBytes } from './space.ts';
import { UPDATE_METHOD_LABEL } from './tool-update.ts';
import { jobErrorText, remedyText } from './localized-text.ts';

/**
 * 从链接导入（设计稿 import-flow.jsx、import-panel.jsx、model-import.js；Runtime 的 `link-import` 流程，架构设计 §7.9）。
 * 这里是纯逻辑：认出流程任务、读冻结参数与结果摘要、三步进度、失败的说法与补救、下载工具卡片的几种状态。
 *
 * 与设计稿的出入：
 * - 首页起的导入不带 `videoId`：流程只解析、下载、校验、放进下载目录；建视频与转录由首页的流程执行器在流程完成之后做
 *   （components/start/flow-runner.ts），所以「确认媒体并建视频」与「生成字幕」两步的状态有一半来自那边。那边导入素材时
 *   带上 `linkProvenance` 的来源，视频详情照样有「来源信息」。
 * - 下载工具只在本机（没有「用哪台电脑下载」）。要登录的网站在下载视频的「网站登录」里勾选浏览器（model/link-cookies.ts），
 *   Runtime 按勾选的顺序逐个用它们的 Cookie。
 * - 失败记录不能删：Runtime 没有删任务的接口，记录留在后台任务里。
 */

export const LINK_IMPORT = 'link-import';
export const DOWNLOADER = 'yt-dlp';

/** 首页起的、或别处起的链接导入父任务。 */
export function isLinkImport(job: Pick<JobRecord, 'kind' | 'pipeline'> | null | undefined): boolean {
  return !!job && job.kind === 'pipeline' && job.pipeline?.name === LINK_IMPORT;
}

export interface LinkFrozen {
  /** 脱敏之后的链接。 */
  url: string;
  host: string;
  audioOnly: boolean;
  /** 冻结的下载目录。 */
  outDir: string | null;
  videoId: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** 冻结的参数里给人看的几项（Runtime 存的是脱敏后的链接）。 */
export function linkFrozen(job: Pick<JobRecord, 'pipeline'>): LinkFrozen {
  const p = job.pipeline?.params ?? {};
  const url = str(p.url) ?? '';
  return {
    url,
    host: str(p.host) ?? (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '').replace(/^www\./i, ''),
    audioOnly: p.audioOnly === true,
    outDir: str(p.outDir),
    videoId: str(p.videoId),
  };
}

/** 完成时的结果摘要；形状不对（或没完成）时 null。 */
export function linkSummary(job: Pick<JobRecord, 'pipeline'>): LinkImportSummary | null {
  const s = job.pipeline?.summary as Partial<LinkImportSummary> | null | undefined;
  if (!s || typeof s !== 'object' || !s.files || typeof s.files.media !== 'string') return null;
  return {
    url: str(s.url) ?? '',
    title: str(s.title),
    platform: str(s.platform),
    uploader: str(s.uploader),
    durationSec: typeof s.durationSec === 'number' ? s.durationSec : null,
    files: { media: s.files.media, subtitles: Array.isArray(s.files.subtitles) ? s.files.subtitles.filter((f) => typeof f === 'string') : [] },
    tool: s.tool && typeof s.tool === 'object' ? s.tool : { name: DOWNLOADER, version: '', source: '' },
    cookieBrowser: LINK_COOKIE_BROWSERS.includes(s.cookieBrowser as LinkCookieBrowser) ? (s.cookieBrowser as LinkCookieBrowser) : null,
    downloadedAt: str(s.downloadedAt) ?? '',
    videoId: str(s.videoId),
    assetId: str(s.assetId),
    transcribeJobId: str(s.transcribeJobId),
  };
}

/** 解析步骤留下的元数据（标题、平台）：流程没完成也能先显示。 */
export function linkMeta(job: Pick<JobRecord, 'pipeline'>): { title: string | null; platform: string | null; durationSec: number | null } {
  const summary = linkSummary(job);
  if (summary) return { title: summary.title, platform: summary.platform, durationSec: summary.durationSec };
  const resolve = job.pipeline?.steps.find((s) => s.name === 'resolve')?.output ?? null;
  const meta = resolve?.metadata && typeof resolve.metadata === 'object' ? (resolve.metadata as Record<string, unknown>) : null;
  return {
    title: str(meta?.title),
    platform: str(meta?.platform),
    durationSec: typeof meta?.durationSec === 'number' ? (meta.durationSec as number) : null,
  };
}

/**
 * 首页起的导入完成之后建视频时，素材要记的来源：与流程自己导入（给了 `videoId`）时 `importIntoVideo` 记的同形
 * （`origin: 'link-import'`，脱敏的链接、平台元数据、工具与版本、下载时间、父任务）。摘要里没有的几项取解析步骤的元数据。
 * 没完成时 null。
 */
export function linkProvenance(job: Pick<JobRecord, 'jobId' | 'pipeline'>): { origin: string; source: Record<string, unknown> } | null {
  const summary = linkSummary(job);
  if (!summary) return null;
  const resolve = job.pipeline?.steps.find((s) => s.name === 'resolve')?.output ?? null;
  const meta = resolve?.metadata && typeof resolve.metadata === 'object' ? (resolve.metadata as Record<string, unknown>) : {};
  return {
    origin: LINK_IMPORT,
    source: {
      url: summary.url || linkFrozen(job).url,
      webpageUrl: str(meta.webpageUrl),
      platform: summary.platform ?? str(meta.platform),
      mediaId: str(meta.mediaId),
      title: summary.title ?? str(meta.title),
      uploader: summary.uploader ?? str(meta.uploader),
      uploadDate: str(meta.uploadDate),
      durationSec: summary.durationSec,
      tool: summary.tool,
      downloadedAt: summary.downloadedAt || null,
      jobId: job.jobId,
    },
  };
}

/** 任务列表里的标题：「从链接导入 · 标题」，标题还不知道时写主机名。 */
export function linkTitle(job: Pick<JobRecord, 'pipeline'>): string {
  const meta = linkMeta(job);
  const name = meta.title ?? (linkFrozen(job).host || null);
  return M.title(name);
}

/** 任务表与胶囊上念的种类（`kind` 是通用的 `pipeline`）。 */
export function linkKindLabel(): string {
  return M.title(null);
}

/**
 * 父任务的阶段 → 一句话（`phase` 由流程的各步上报）。建字幕层那一步上报的也是 `applying`，与导入视频同名，
 * 按正在跑的那一步说成「生成字幕」。
 */
export function linkPhaseText(job: Pick<JobRecord, 'phase' | 'pipeline'>): string {
  if (job.pipeline?.steps.find((s) => s.status === 'running')?.name === 'captions') return M.stageSubs;
  return M.phase[job.phase] ?? M.phaseFallback;
}

/** 下载这一步的字节进度（子任务上报的 `bytes`）：百分比与「12 MB / 45 MB」。没有时 null。 */
export function downloadProgress(job: Pick<JobRecord, 'pipeline'>, jobs: readonly JobRecord[]): { pct: number | null; text: string } | null {
  const step = job.pipeline?.steps.find((s) => s.name === 'download');
  if (!step?.jobId || step.status !== 'running') return null;
  const child = jobs.find((j) => j.jobId === step.jobId);
  const p = child?.progress;
  if (!p || p.unit !== 'bytes') return null;
  if (!p.total) return { pct: null, text: M.downloaded(formatBytes(p.done)) };
  const pct = Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)));
  return { pct, text: `${formatBytes(p.done)} / ${formatBytes(p.total)}` };
}

// ---- 三步：下载视频 · 确认媒体并建视频 · 生成字幕 ----

export type StageState = 'pending' | 'current' | 'done' | 'failed' | 'skipped';

export interface LinkStage {
  key: 'download' | 'video' | 'subs';
  label: string;
  state: StageState;
}

/** 流程完成之后首页执行器那一半做到哪了；不是首页起的（或应用重启过）时 null。 */
export interface FollowUp {
  video: 'pending' | 'running' | 'done' | 'failed';
  /** 不转录（音频转视频关了字幕）时 `skipped`。 */
  subs: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
}

const STOPPED = new Set(['failed', 'cancelled', 'interrupted']);

function stepsState(job: Pick<JobRecord, 'pipeline'>, names: readonly string[]): StageState {
  const steps = (job.pipeline?.steps ?? []).filter((s) => names.includes(s.name));
  if (!steps.length) return 'pending';
  if (steps.some((s) => STOPPED.has(s.status))) return 'failed';
  if (steps.every((s) => s.status === 'completed' || s.status === 'skipped')) return 'done';
  if (steps.some((s) => s.status === 'running' || s.status === 'completed')) return 'current';
  return 'pending';
}

export function linkStages(job: Pick<JobRecord, 'pipeline' | 'state'>, follow: FollowUp | null): LinkStage[] {
  const download = stepsState(job, ['resolve', 'download']);
  const fetched = stepsState(job, ['verify', 'publish']);
  // 带 videoId 起的导入（别处）：流程自己导入、转写。
  const own = (job.pipeline?.steps ?? []).some((s) => s.name === 'import');
  let video: StageState;
  let subs: StageState;
  if (own) {
    const imported = stepsState(job, ['verify', 'publish', 'import']);
    video = imported;
    const transcribeStep = (job.pipeline?.steps ?? []).some((s) => s.name === 'transcribe');
    subs = transcribeStep ? stepsState(job, ['transcribe']) : 'skipped';
  } else {
    video =
      fetched === 'failed' || follow?.video === 'failed'
        ? 'failed'
        : fetched === 'done' && follow?.video === 'done'
          ? 'done'
          : fetched === 'current' || (fetched === 'done' && (follow?.video === 'running' || follow?.video === 'pending'))
            ? 'current'
            : fetched === 'done' && !follow
              ? 'current'
              : 'pending';
    subs = !follow ? 'pending' : follow.subs === 'running' ? 'current' : follow.subs === 'pending' ? 'pending' : follow.subs;
  }
  if (download === 'failed') video = 'pending';
  return [
    { key: 'download', label: M.stageDownload, state: download },
    { key: 'video', label: M.stageVideo, state: video },
    { key: 'subs', label: M.stageSubs, state: subs },
  ];
}

// ---- 失败的说法与补救 ----

export type LinkAction = 'retry' | 'change-link' | 'use-file' | 'tools' | 'restart' | 'downloads';

export interface LinkIssue {
  code: string;
  title: string;
  body: string;
  /** 补救按钮，第一个是主按钮。 */
  actions: LinkAction[];
  /** 下载工具给的原话（标准错误的结尾，链接已脱敏）；没有时 null。 */
  diag: string | null;
}

/** 认得的失败码 → 补救按钮（第一个是主按钮）；标题与说明在文案目录的 `issue` 里。 */
const LINK_ISSUE_ACTIONS: Record<string, LinkAction[]> = {
  TOOL_NOT_INSTALLED: ['tools'],
  TOOL_CONSENT_REQUIRED: ['tools'],
  TOOL_UNAVAILABLE: ['tools'],
  TOOL_OUTDATED: ['tools', 'retry'],
  OFFLINE_STRICT: ['use-file'],
  LINK_UNSUPPORTED: ['change-link', 'use-file'],
  LINK_LOGIN_REQUIRED: ['use-file', 'change-link'],
  LINK_COOKIES_UNAVAILABLE: ['change-link', 'retry'],
  LINK_TOOL_UPDATE_REQUIRED: ['tools', 'retry'],
  LINK_UNAVAILABLE: ['change-link', 'use-file'],
  LINK_NETWORK_ERROR: ['retry', 'use-file'],
  LINK_DISK_FULL: ['retry', 'downloads'],
  LINK_DOWNLOAD_FAILED: ['retry', 'tools', 'use-file'],
  LINK_DOWNLOAD_UNREADABLE: ['retry', 'change-link', 'use-file'],
  LINK_DESTINATION_UNAVAILABLE: ['downloads', 'restart'],
  MEDIA_TOOL_UNAVAILABLE: ['retry'],
  LINK_SOURCE_EXPIRED: ['restart'],
  INTERRUPTED: ['retry'],
};

/** 父任务的错误（或 `pipelines.start` 的拒绝）→ 标题、说明、补救按钮。不认得的码照 Runtime 的原话写。 */
export function linkIssue(error: Pick<JobError, 'code' | 'message' | 'messageRef' | 'details'> | null, state?: JobRecord['state']): LinkIssue | null {
  if (!error && state !== 'interrupted') return null;
  const code = error?.code ?? 'INTERRUPTED';
  const details = (error?.details && typeof error.details === 'object' ? error.details : {}) as Record<string, unknown>;
  const stderr = str(details.stderr);
  const knownCode = LINK_ISSUE_ACTIONS[code] ? code : state === 'interrupted' ? 'INTERRUPTED' : null;
  const known = knownCode ? M.issue[knownCode] : undefined;
  if (knownCode && known) return { code, title: known.title, body: known.body, actions: [...LINK_ISSUE_ACTIONS[knownCode]!], diag: stderr };
  const remedy = remedyText(details);
  return {
    code,
    title: M.issueUnknownTitle,
    body: M.issueUnknownBody(jobErrorText(error) || null, remedy),
    actions: ['retry', 'use-file'],
    diag: stderr,
  };
}

/** `pipelines.start` 被拒时，错误里的码（`RpcError.details.code`）。 */
export function rejectionCode(error: unknown): string | null {
  const details = (error as { details?: unknown } | null)?.details;
  const code = details && typeof details === 'object' ? (details as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

/** 链接导入的大标题（设计稿 `ImportTask` 的 heading）。 */
export function linkHeading(job: Pick<JobRecord, 'state'>, follow: FollowUp | null): string {
  if (job.state === 'cancelled') return M.headingStopped;
  if (job.state === 'failed' || job.state === 'interrupted' || job.state === 'needs-reconciliation') return M.headingFailed;
  if (job.state !== 'completed') return M.headingRunning;
  if (!follow) return M.headingDownloaded;
  if (follow.video === 'failed') return M.headingVideoFailed;
  if (follow.video !== 'done') return M.headingCreatingVideo;
  if (follow.subs === 'running' || follow.subs === 'pending') return M.headingTranscribing;
  if (follow.subs === 'failed') return M.headingTranscribeFailed;
  return follow.subs === 'skipped' ? M.headingReady : M.headingSubsReady;
}

// ---- 下载工具卡片 ----

export type ToolCardState = 'checking' | 'unknown' | 'installing' | 'updating' | 'install' | 'update' | 'broken' | 'blocked' | 'consent' | 'ready';

export interface ToolCard {
  state: ToolCardState;
  title: string;
  body: string;
  /** 主按钮（同意并安装 / 同意并更新 / 同意使用）；没有时 null。 */
  action: string | null;
  /** 来源、版本、大小、许可这类事实，一行一项。 */
  facts: string[];
}

export const TOOL_SOURCE_LABEL: Record<NonNullable<ExternalToolStatus['source']>, string> = live(() => M.toolSource);

/** 下载工具能不能直接用：装好了、版本够、同意过。 */
export function toolReady(status: ExternalToolStatus | null | undefined): boolean {
  return !!status && status.state === 'installed' && (!status.consentRequired || status.consent?.state === 'granted');
}

function offerFacts(status: ExternalToolStatus): string[] {
  const o = status.offer;
  if (!o) return [];
  const size = o.sizeBytes ?? o.estimatedBytes;
  let from = '';
  try {
    from = o.url ? new URL(o.url).host : '';
  } catch {
    from = '';
  }
  return [
    M.factVersion(o.version, size ? formatBytes(size) : null),
    [from ? M.factFrom(from) : null, o.license ? M.factLicense(o.license) : null].filter(Boolean).join(' · '),
    M.factIsolated,
  ].filter(Boolean);
}

/** 此刻用的那一份：版本、来源、安装方式（能判断时），与它的路径。 */
function usedFacts(status: ExternalToolStatus): string[] {
  const where = [
    status.version ? `yt-dlp ${status.version}` : 'yt-dlp',
    status.source ? TOOL_SOURCE_LABEL[status.source] : null,
    status.update ? M.factInstalledWith(UPDATE_METHOD_LABEL[status.update.method] ?? status.update.method) : null,
  ].filter(Boolean).join(' · ');
  return [where, status.path ? shortenPath(status.path) : null].filter((f): f is string => !!f);
}

/**
 * 链接档开始之前的下载工具卡片（设计稿 `DownloaderSettings` 与 `issues.missing/outdated`）。只读 `externalTools.detect`
 * 的结果；安装与同意都要用户点了才做（`externalTools.install` 带 `consent: true` 时同时记下同意）。系统里的那一份按原安装方式
 * 更新（产品设计 §2.7）：命令与输出在卡片的「更新」一节，更新期间卡片是 `updating`。
 */
export function toolCard(probed: ExternalToolStatus | null | undefined, opts: { checking: boolean; installing: boolean; updating?: boolean }): ToolCard {
  const status = probed && localizeToolStatus(probed);
  if (opts.checking && !status) return { state: 'checking', title: M.cardChecking, body: M.cardCheckingBody, action: null, facts: [] };
  if (!status) return { state: 'unknown', title: M.cardUnknown, body: M.cardUnknownBody, action: null, facts: [] };
  if (opts.installing || status.installJobId)
    return {
      state: 'installing',
      title: M.cardInstalling,
      body: M.cardInstallingBody,
      action: null,
      facts: offerFacts(status),
    };
  if (opts.updating || status.updateJobId)
    return { state: 'updating', title: M.cardUpdating, body: M.cardUpdatingBody, action: null, facts: usedFacts(status) };
  const blocked = !status.installable || !status.offer || !!status.offer.blockedReason;
  const why = status.offer?.blockedReason ?? status.remedy ?? status.reason ?? M.cardBlockedWhy;
  if (status.state === 'missing') {
    if (blocked)
      return { state: 'blocked', title: M.cardMissing, body: M.cardMissingBody(why), action: null, facts: [] };
    return {
      state: 'install',
      title: M.cardInstall,
      body: M.cardInstallBody,
      action: M.cardInstallAction,
      facts: offerFacts(status),
    };
  }
  if (status.state === 'outdated') {
    const body = M.cardOutdatedReason(status.reason, status.version, status.minVersion);
    if (blocked || status.source === 'system' || status.source === 'env' || status.source === 'user')
      return {
        state: 'blocked',
        title: M.cardOutdated,
        body: M.cardOutdatedBlocked(
          body,
          status.source === 'managed' ? why : status.update?.runnable ? M.cardOutdatedRunnable : M.cardOutdatedManual,
        ),
        action: null,
        facts: [],
      };
    return { state: 'update', title: M.cardOutdated, body: M.cardOutdatedUpdate(body), action: M.cardUpdateAction, facts: offerFacts(status) };
  }
  if (status.state === 'unavailable') {
    const body = M.cardBrokenBody(status.reason, status.remedy);
    return blocked
      ? { state: 'blocked', title: M.cardBroken, body, action: null, facts: [] }
      : { state: 'broken', title: M.cardBroken, body, action: M.cardReinstallAction, facts: offerFacts(status) };
  }
  const facts = usedFacts(status);
  if (status.consentRequired && status.consent?.state !== 'granted')
    return {
      state: 'consent',
      title: status.consent?.state === 'revoked' ? M.cardConsentRevoked : M.cardConsent,
      body: M.cardConsentBody,
      action: M.cardConsentAction,
      facts,
    };
  return { state: 'ready', title: M.cardReady, body: M.cardReadyBody, action: null, facts };
}

/** 下载位置那一行（Runtime 的规则：设了 `downloads.directory` 就一律在那里，否则是运行主机的 ~/Downloads）。 */
export function downloadDirLabel(setting: string | null, _projectPath: string | null): string {
  if (setting) return shortenPath(setting);
  return '~/Downloads';
}
