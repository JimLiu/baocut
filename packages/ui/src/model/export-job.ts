import {
  defineMessages,
  intlLocale,
  live,
  localizeText,
  type ExportKind,
  type ExportSettings,
  type GeneratedOutput,
  type Id,
  type JobRecord,
} from '@baocut/protocol';
import { JOB_PHASE_LABEL } from '../copy.ts';
import { jobWaitText } from './localized-text.ts';
import { formatClock } from './format.ts';
import { fmtSize } from './task-facts.ts';
import { jobLive, jobPercent, jobRetrying } from './task-list.ts';
import { zhHans } from './export-job.zh-Hans.ts';
import { zhHant } from './export-job.zh-Hant.ts';
import { ja } from './export-job.ja.ts';
import { ko } from './export-job.ko.ts';
import { es } from './export-job.es.ts';
import { fr } from './export-job.fr.ts';
import { de } from './export-job.de.ts';
import { nl } from './export-job.nl.ts';
import { ptBR } from './export-job.pt-BR.ts';
import { it } from './export-job.it.ts';
import { ru } from './export-job.ru.ts';
import { pl } from './export-job.pl.ts';
import { tr } from './export-job.tr.ts';
import { vi } from './export-job.vi.ts';

/** 内部检查的导出保留后台任务记录，但不作为会话交付。旧记录没有用途时照常显示。 */
export function isPreviewExport(job: JobRecord): boolean {
  return job.kind === 'export' && job.export?.settings.purpose === 'preview';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 导出任务的文案（英文是键与类型的来源，译文在 `export-job.zh-Hans.ts`）。 */
const en = {
  tabVideo: 'Video',
  tabAudio: 'Audio',
  tabSubtitles: 'Subtitles',
  tabTranscript: 'Transcript',
  tabProject: 'Project file',
  export: 'Export',
  queued: 'Export queued',
  exporting: 'Exporting…',
  exportingPct: (pct: number) => `Exporting · ${pct}%`,
  formats: { md: 'Markdown', txt: 'Plain text', xmeml: 'FCP7 XML' } as Record<string, string>,
  titleVideo: (format: string) => `Export video · ${format}`,
  titleAudio: (format: string) => `Export audio · ${format}`,
  titleSubtitles: (format: string) => `Export subtitles · ${format}`,
  titleTranscript: (format: string) => `Export transcript · ${format}`,
  titlePortable: 'Export portable package',
  titleProject: (format: string) => `Export project file · ${format}`,
  generating: {
    video: 'Encoding',
    audio: 'Mixing',
    subtitles: 'Writing files',
    transcript: 'Writing files',
    portable: 'Packaging',
    project: 'Writing project file',
  } as Record<ExportKind, string>,
  retrying: 'Retrying automatically after an error',
  saving: 'Saving files',
  framesOf: (done: string, total: string) => `Rendered ${done} / ${total} frames`,
  frames: (done: string) => `Rendered ${done} frames`,
  secondsOf: (done: string, total: string) => `Processed ${done} / ${total}`,
  seconds: (done: string) => `Processed ${done}`,
  outputsOf: (done: number, total: number) => `Wrote ${done} / ${total} ${total === 1 ? 'file' : 'files'}`,
  outputs: (done: number) => `Wrote ${plural(done, 'file', 'files')}`,
  bytesOf: (done: string, total: string) => `Packaged ${done} / ${total}`,
  bytes: (done: string) => `Packaged ${done}`,
  mono: 'Mono',
  stereo: 'Stereo',
  entries: (n: number) => plural(n, 'entry', 'entries'),
  files: (n: number) => plural(n, 'file', 'files'),
  assetRevisions: (n: number) => plural(n, 'asset version', 'asset versions'),
  missing: (n: number) => `${n} missing`,
  clips: (n: number) => plural(n, 'clip', 'clips'),
  omitted: (n: number) => `${plural(n, 'item', 'items')} not written to the project file`,
  doneMany: (n: number, total: string) => `${plural(n, 'file', 'files')} · ${total} total`,
  cancelledKept: (n: number) => `${n === 1 ? 'The saved file is' : `The ${n} saved files are`} kept · The video itself is unaffected`,
  cancelledRemoved: 'Unfinished files were deleted · The video itself is unaffected',
};
export type ExportJobMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 导出任务（`kind: 'export'` 的 JobRecord）在界面上的读法（设计稿 export.jsx 的运行 / 完成 / 取消态，架构设计 §9.11）：
 * 顶栏按钮、弹层与后台任务读同一条记录。进度只读 Runtime 报的 `progress`，没有总量时不念百分比；
 * 设计稿的剩余时间与 fps 没有来源，不写。
 */

export type ExportTab = 'video' | 'audio' | 'subtitles' | 'transcript' | 'project';

export const EXPORT_TABS: readonly { key: ExportTab; label: string }[] = [
  {
    key: 'video',
    get label() {
      return M.tabVideo;
    },
  },
  {
    key: 'audio',
    get label() {
      return M.tabAudio;
    },
  },
  {
    key: 'subtitles',
    get label() {
      return M.tabSubtitles;
    },
  },
  {
    key: 'transcript',
    get label() {
      return M.tabTranscript;
    },
  },
  {
    key: 'project',
    get label() {
      return M.tabProject;
    },
  },
];

/** 导出种类落在哪一页：便携包与工程都在「工程」页。 */
export function tabOfKind(kind: ExportKind): ExportTab {
  return kind === 'portable' || kind === 'project' ? 'project' : kind;
}

const newestFirst = (a: JobRecord, b: JobRecord) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.jobId.localeCompare(a.jobId);

/** 这个视频的导出任务，后起的在前。 */
export function videoExports(jobs: readonly JobRecord[], videoId: Id): JobRecord[] {
  return jobs.filter((j) => j.kind === 'export' && j.videoId === videoId).sort(newestFirst);
}

/** 这个视频最近一条还没结束的导出（谁提交的都算：App、智能体、命令行）。 */
export function latestLiveExport(jobs: readonly JobRecord[], videoId: Id): JobRecord | null {
  return videoExports(jobs, videoId).find(jobLive) ?? null;
}

/** 顶栏按钮的字：没在导时是「导出」；在导时「导出中 · 31%」，没有总量时「导出中…」，排队时「导出排队中」。 */
export function exportButtonLabel(job: JobRecord | null): string {
  if (!job) return M.export;
  if (job.state === 'queued') return M.queued;
  const pct = job.state === 'running' ? jobPercent(job) : null;
  return pct == null ? M.exporting : M.exportingPct(pct);
}

export type ExportView = 'run' | 'done' | 'cancelled' | 'failed' | 'interrupted';

export function exportView(job: JobRecord): ExportView {
  if (jobLive(job)) return 'run';
  switch (job.state) {
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    default:
      return 'failed';
  }
}

const FORMAT_LABEL: Record<string, string> = live(() => M.formats);
const formatLabel = (format: string) => FORMAT_LABEL[format] ?? format.toUpperCase();

/** 「导出视频 · MP4」「导出字幕 · SRT」「导出便携包」。 */
export function exportTitle(settings: ExportSettings): string {
  switch (settings.kind) {
    case 'video':
      return M.titleVideo(formatLabel(settings.format));
    case 'audio':
      return M.titleAudio(formatLabel(settings.format));
    case 'subtitles':
      return M.titleSubtitles(formatLabel(settings.format));
    case 'transcript':
      return M.titleTranscript(formatLabel(settings.format));
    case 'portable':
      return M.titlePortable;
    case 'project':
      return M.titleProject(formatLabel(settings.format));
  }
}

const GENERATING: Record<ExportKind, string> = live(() => M.generating);

/** 阶段：生成这一步按种类说（编码、混音、打包……），校验与保存沿用通用的说法。 */
export function exportPhaseLabel(job: Pick<JobRecord, 'state' | 'endedAt' | 'phase' | 'export' | 'wait'>): string {
  // 排队时照 Runtime 记着的说在等什么（并发名额或机器资源，架构设计 §7.6）。
  if (job.state === 'queued') return jobWaitText(job.wait) ?? JOB_PHASE_LABEL.queued;
  if (jobRetrying(job)) return M.retrying;
  if (job.phase === 'generating' && job.export) return GENERATING[job.export.settings.kind];
  if (job.phase === 'publishing') return M.saving;
  return JOB_PHASE_LABEL[job.phase];
}

/** 进度的事实：已画 1,200 / 3,600 帧、已处理 0:40 / 3:00（音频：混音，开了响度标准化时连同母带）、已写 1 / 3 个文件、已打包 120 MB / 1.2 GB。 */
export function exportProgressLine(job: Pick<JobRecord, 'progress' | 'state'>): string | null {
  const p = job.progress;
  if (!p || job.state !== 'running') return null;
  const number = new Intl.NumberFormat(intlLocale());
  const n = (v: number) => number.format(Math.floor(v));
  switch (p.unit) {
    case 'frames':
      return p.total != null ? M.framesOf(n(p.done), n(p.total)) : M.frames(n(p.done));
    case 'seconds':
      return p.total != null ? M.secondsOf(formatClock(p.done), formatClock(p.total)) : M.seconds(formatClock(p.done));
    case 'outputs':
      return p.total != null ? M.outputsOf(p.done, p.total) : M.outputs(p.done);
    case 'bytes':
      return p.total != null ? M.bytesOf(fmtSize(p.done), fmtSize(p.total)) : M.bytes(fmtSize(p.done));
    default:
      return null;
  }
}

const basename = (file: string) => file.split(/[\\/]/).pop() || file;

/** 正在写的文件：提交时定下的名字（发布时重名会再加序号，以完成后的路径为准）。 */
export function exportPlannedFiles(job: Pick<JobRecord, 'export'>): string[] {
  return job.export?.destination.files ?? [];
}

export interface ExportOutputFact {
  key: string;
  name: string;
  path: string | null;
  /** 「1920×1080 · 3:26 · 84 MB」「312 条 · 18 KB」。 */
  meta: string;
}

function outputMeta(output: GeneratedOutput): string {
  const size = fmtSize(output.byteLength);
  const m = output.media;
  switch (m.kind) {
    case 'video':
      return [`${m.width}×${m.height}`, formatClock(m.durationSec), size].join(' · ');
    case 'audio':
      return [formatClock(m.durationSec), `${Math.round(m.sampleRate / 100) / 10} kHz`, m.channels === 1 ? M.mono : M.stereo, size].join(' · ');
    case 'text':
      return [M.entries(m.entries), size].join(' · ');
    case 'package':
      return [M.files(m.files), M.assetRevisions(m.assets), ...(m.missingAssets ? [M.missing(m.missingAssets)] : []), size].join(' · ');
    case 'project':
      return [M.clips(m.clips), ...(m.omitted ? [M.omitted(m.omitted)] : []), size].join(' · ');
    default:
      return size;
  }
}

/** 已经发布的文件（完成；或失败但发布了一部分）：文件名取实际路径，重名加过的序号也在里面。 */
export function exportOutputs(job: Pick<JobRecord, 'result'>): ExportOutputFact[] {
  return (job.result?.outputs ?? []).map((o, i) => ({
    key: `${o.artifactId}:${i}`,
    name: o.path ? basename(o.path) : o.artifactId,
    path: o.path ?? null,
    meta: outputMeta(o),
  }));
}

/** 导出所在的目录（「在文件夹中显示」没有文件时打开目录）。 */
export function exportDir(job: Pick<JobRecord, 'export'>): string | null {
  return job.export?.destination.dir ?? null;
}

/** 完成态的一行：「访谈.mp4 · 84 MB」；几个文件时「3 个文件 · 共 120 MB」。 */
export function exportDoneLine(job: Pick<JobRecord, 'result'>): string {
  const outputs = job.result?.outputs ?? [];
  if (!outputs.length) return '';
  const total = fmtSize(outputs.reduce((sum, o) => sum + o.byteLength, 0));
  return outputs.length === 1 ? `${basename(outputs[0]!.path ?? outputs[0]!.artifactId)} · ${total}` : M.doneMany(outputs.length, total);
}

/** 取消的结果：取消只在开始保存文件之前生效，没写完的文件随之删掉。 */
export function cancelledLine(job: Pick<JobRecord, 'result'>): string {
  const saved = job.result?.outputs?.length ?? 0;
  return saved ? M.cancelledKept(saved) : M.cancelledRemoved;
}

/** 已经点了取消、还没停下（开始保存文件之后不再中途停下）。 */
export function cancelPending(job: Pick<JobRecord, 'cancellation' | 'state' | 'endedAt'>): boolean {
  return !!job.cancellation && jobLive(job);
}

/** 警告：逐条列出（跳过的内容、没写进工程的对象、响度测不出……），同码同句的只留一条。 */
export function exportWarnings(job: Pick<JobRecord, 'warnings'>): string[] {
  return [...new Set(job.warnings.map((w) => localizeText(w.detail, w.detailRef) ?? w.code))];
}
