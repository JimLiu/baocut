import path from 'node:path';
import type { ExportSettings, GeneratedOutput, Id, SpaceEntry, SpaceEntryKind, SpaceEntryOrigin, SpaceEntryStatus } from '@baocut/protocol';
import { isFilePipelineJob, type SpaceImport, type SpaceJobFacts, type SpaceMark, type TrashedVideo } from '@baocut/runtime-storage';
import type { VideoFacts } from './content-extract.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

/**
 * Space 目录的派生（架构设计 §5.7）：从来源目录的扫描、`space.import` 的登记、Job Ledger 与内容索引里的视频事实，
 * 算出全部条目。纯函数：同样的输入得到同样的结果，所以删掉目录重建与增量更新的结果一致（`user.*` 在 Runtime Store 里）。
 *
 * - 扫描到的文件与视频目录是基础条目；视频目录在内容索引里有记录时带上 `ref.videoId`，与根序列的时长、画布尺寸（`media`）。
 * - 导出发布到来源目录里的文件，与扫描到的那个文件合成一个条目：带上导出的来源与 `published` / `source-changed`。
 *   发布到来源目录之外的导出单独成条，`id` 是 artifactId。文件到文件的流程（文件转码、字幕文件的翻译，§7.9）发布的文件同样处理，
 *   来源是 `generated`，`capability` 是流程名，带执行者。
 * - 生成的图片、音频与文本是产物条目（`id` 为 artifactId）：导入了视频的是 `candidate`，时间线用上了是 `applied`。
 * - 排队与运行中的生成、导出是 `generating` 占位；失败的是 `failed` 占位，用户清除或同样的输入后来成功了就不再显示。
 * - 转写的原始结果与导出的冻结快照不是可交付的产物，不进目录；代理、缩略图、波形本来就不在 Artifact Store 里。
 * - 删除了的视频（`videos.delete`）是回收站里的视频条目，`id` 由来源与它在回收站里的位置决定，不是视频目录（`videoDir` 为空）。
 * - 任务的输入是 Job Ledger 与 Space 自己的产物记录的并集（`SpaceJobFacts`，Ledger 里有的以 Ledger 为准）。
 */

export interface DeriveSource {
  key: string;
  root: string;
  /** 来源目录的真实路径（导出记下的发布路径是真实路径）；还没解析时与 `root` 相同。 */
  realRoot: string;
  projectId: Id | null;
  conversationId: Id | null;
}

export interface ScannedFile {
  relPath: string;
  kind: SpaceEntryKind;
  size: number;
  mtimeMs: number;
}

export interface ScannedItem {
  sourceKey: string;
  file: ScannedFile;
}

/** 内容索引里的一个视频。 */
export interface KnownVideo {
  videoId: Id;
  name: string;
  revision: string;
  facts: VideoFacts;
}

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

/** 条目的 bytes 在哪里（媒体通道与物理删除用）。 */
export type EntryLocation =
  | { kind: 'source'; sourceKey: string; relPath: string }
  | { kind: 'artifact'; artifactId: string; path: string }
  | { kind: 'file'; path: string }
  /** 删除了的视频：来源目录里 `.bcut-trash/` 下的视频目录。 */
  | { kind: 'trash'; sourceKey: string; relPath: string }
  | { kind: 'none' };

export interface DerivedEntry {
  entry: SpaceEntry;
  location: EntryLocation;
  /** 视频条目：视频目录的绝对路径。 */
  videoDir?: string;
}

export interface DeriveInput {
  sources: ReadonlyMap<string, DeriveSource>;
  files: ReadonlyMap<Id, ScannedItem>;
  mark: (id: Id) => SpaceMark;
  imports: ReadonlyMap<Id, SpaceImport>;
  /** 删除了的视频，键是回收站里的条目 id。 */
  trashedVideos: ReadonlyMap<Id, TrashedVideo>;
  jobs: readonly SpaceJobFacts[];
  /** 视频目录（绝对路径）在内容索引里的记录。 */
  videoAt: (dir: string) => KnownVideo | null;
  projectOfConversation: (conversationId: Id) => Id | null;
  /** 产物文件：`undefined` 是还没查过（按存在处理），`null` 是不在了。 */
  artifactFile: (artifactId: string) => FileStat | null | undefined;
  /** 来源目录之外的发布路径，同上。 */
  pathStat: (file: string) => FileStat | null | undefined;
  entryIdOf: (sourceKey: string, relPath: string) => Id;
  classify: (fileName: string) => SpaceEntryKind | null;
}

/** 产物条目按能力起的名字（派生时按当前语言，不写进磁盘）；不产出条目的任务种类给 `null`。 */
function labelOf(kind: string): string | null {
  switch (kind) {
    case 'synthesizeSpeech':
      return RcSpace.labelSynthesizeSpeech().text;
    case 'generateImage':
      return RcSpace.labelGenerateImage().text;
    case 'generateText':
      return RcSpace.labelGenerateText().text;
    case 'export':
      return RcSpace.labelExport().text;
    default:
      return null;
  }
}

export function deriveEntries(input: DeriveInput): Map<Id, DerivedEntry> {
  const out = new Map<Id, DerivedEntry>();
  const videos = new Map<Id, { entryId: Id; source: DeriveSource; known: KnownVideo }>();

  // 1. 扫描到的文件与视频目录。
  for (const [id, item] of input.files) {
    const source = input.sources.get(item.sourceKey);
    if (!source) continue;
    const fileName = item.file.relPath.slice(item.file.relPath.lastIndexOf('/') + 1);
    const entry: SpaceEntry = {
      id,
      kind: item.file.kind,
      name: fileName,
      fileName,
      source: { projectId: source.projectId, conversationId: source.conversationId },
      relPath: item.file.relPath,
      size: item.file.size,
      lastActivityAt: new Date(item.file.mtimeMs).toISOString(),
      status: null,
      user: { favorite: false, displayName: null, trashedAt: null },
    };
    const derived: DerivedEntry = { entry, location: { kind: 'source', sourceKey: item.sourceKey, relPath: item.file.relPath } };
    if (item.file.kind === 'video') {
      const dir = path.join(source.root, ...item.file.relPath.split('/'));
      derived.videoDir = dir;
      const known = input.videoAt(dir);
      if (known) {
        entry.ref = { videoId: known.videoId };
        // 「时长或尺寸」一列：工作稿根序列的时长与画布尺寸（索引读到之后；快照不全时没有）。
        const timeline = known.facts.timeline;
        if (timeline) entry.media = { durationSec: timeline.durationSec, width: timeline.width, height: timeline.height };
        if (!videos.has(known.videoId)) videos.set(known.videoId, { entryId: id, source, known });
      }
    }
    out.set(id, derived);
  }

  // 2. `space.import` 登记的项目文件。
  for (const [id, record] of input.imports) {
    const existing = out.get(id);
    const origin: SpaceEntryOrigin = { source: 'imported', projectId: record.projectId };
    if (existing) {
      existing.entry.origin = origin;
      continue;
    }
    const fileName = record.relPath.slice(record.relPath.lastIndexOf('/') + 1);
    out.set(id, {
      entry: {
        id,
        kind: input.classify(fileName) ?? 'document',
        name: fileName,
        fileName,
        source: { projectId: record.projectId, conversationId: null },
        relPath: record.relPath,
        size: 0,
        lastActivityAt: record.importedAt,
        status: 'missing',
        statusDetail: { reason: RcSpace.importedFileGone().text },
        user: { favorite: false, displayName: null, trashedAt: null },
        origin,
      },
      location: { kind: 'none' },
    });
  }

  // 3. Job Ledger：先旧后新，同一个产物以后来的任务为准。
  const jobs = [...input.jobs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const succeededLater = new Map<string, string>();
  for (const job of jobs) {
    if (job.state === 'completed') succeededLater.set(`${job.kind}\0${job.inputHash}`, job.createdAt);
  }
  for (const job of jobs) {
    // 流程新建的视频（§7.9）：视频条目的来源是这次运行。
    if (job.kind === 'pipeline') {
      const created = createdVideoOf(job);
      const video = created ? videos.get(created) : undefined;
      const derived = video ? out.get(video.entryId) : undefined;
      if (video && derived && !derived.entry.origin) {
        const submitter = job.submitter;
        derived.entry.origin = {
          source: 'imported',
          projectId: video.source.projectId,
          videoId: created!,
          ...(submitter.kind === 'agent' ? { conversationId: submitter.id, taskId: submitter.taskId } : {}),
          jobId: job.jobId,
          capability: job.pipeline!.name,
        };
      }
      // 文件到文件的流程：完成时发布的文件，与导出一样合进扫描到的文件或单独成条。
      if (isFilePipelineJob(job) && job.state === 'completed' && job.result) {
        const origin: SpaceEntryOrigin = { ...originOf(job, null, input), capability: job.pipeline!.name };
        for (const output of job.result.outputs ?? []) {
          const download = job.pipeline?.name === 'link-import';
          const projectId = job.pipeline?.params?.projectId;
          const assigned = download ? { ...origin, source: 'imported' as const, projectId: output.media.kind === 'text' && typeof projectId === 'string' ? projectId : null } : origin;
          addExport(out, input, job, output, assigned, null);
        }
      }
      continue;
    }
    if (job.kind === 'transcribe' || labelOf(job.kind) === null) continue;
    const video = job.videoId ? (videos.get(job.videoId) ?? null) : null;
    const origin = originOf(job, video?.source.projectId ?? null, input);
    if (job.state === 'queued' || job.state === 'running') {
      out.set(job.jobId, placeholder(job, 'generating', origin));
      continue;
    }
    if (job.state === 'failed' || job.state === 'interrupted' || job.state === 'needs-reconciliation') {
      const retried = succeededLater.get(`${job.kind}\0${job.inputHash}`);
      if (!input.mark(job.jobId).dismissedAt && !(retried !== undefined && retried > job.createdAt)) {
        out.set(job.jobId, placeholder(job, 'failed', origin));
      }
    }
    // 产物已经发布、应用没有提交（目标不在了、被拒绝、停止之后不再自动应用，§7.3）：产物照样列出，是候选。
    const latest = job.applications?.at(-1);
    const unapplied = latest !== undefined && latest.state !== 'committed' && (job.state === 'failed' || job.state === 'cancelled');
    if (job.state !== 'completed' && !(job.kind === 'export' && job.result) && !unapplied) continue;
    if (!job.result) continue;
    if (job.kind === 'export') {
      for (const output of job.result.outputs ?? []) addExport(out, input, job, output, origin, video?.known ?? null);
    } else if (job.kind === 'generateText') {
      const text = job.result.text;
      const file = input.artifactFile(job.result.artifactId);
      const ext = text?.mediaType === 'application/json' ? 'json' : 'txt';
      const derived = artifactEntry(job, job.result.artifactId, 'document', `${fileNameOf(job, ext, null)}`, file, text?.byteLength ?? 0, origin, {
        mediaType: text?.mediaType ?? 'text/plain',
      });
      savedCopy(derived, input, job.result.outputs?.[0]?.path);
      out.set(job.result.artifactId, derived);
    } else {
      const outputs = job.result.outputs ?? [];
      outputs.forEach((output, index) => {
        const kind: SpaceEntryKind = job.kind === 'generateImage' ? 'image' : 'audio';
        const file = input.artifactFile(output.artifactId);
        const derived = artifactEntry(
          job,
          output.artifactId,
          kind,
          fileNameOf(job, extensionOf(output, file), outputs.length > 1 ? index + 1 : null),
          file,
          output.byteLength,
          origin,
          mediaOf(output),
        );
        if (derived.entry.status === null && output.assetId) {
          derived.entry.status = video?.known.facts.timelineAssetIds.includes(output.assetId) ? 'applied' : 'candidate';
        } else if (derived.entry.status === null && unapplied) {
          derived.entry.status = 'candidate';
          derived.entry.statusDetail = { reason: latest.error?.message ?? RcSpace.resultNotApplied().text, code: latest.state };
        }
        savedCopy(derived, input, output.path);
        out.set(output.artifactId, derived);
      });
    }
  }

  // 4. 删除了的视频：在回收站里，直到恢复或物理删除。来源不在了（项目被移除）时没有位置，只能看、不能恢复。
  for (const [id, record] of input.trashedVideos) {
    const fileName = record.relPath.slice(record.relPath.lastIndexOf('/') + 1);
    out.set(id, {
      entry: {
        id,
        kind: 'video',
        name: record.name,
        fileName,
        source: { projectId: record.projectId, conversationId: record.conversationId },
        relPath: record.relPath,
        size: record.size,
        lastActivityAt: record.trashedAt,
        status: null,
        user: { favorite: false, displayName: null, trashedAt: null },
        ...(record.videoId ? { ref: { videoId: record.videoId } } : {}),
      },
      location: input.sources.has(record.sourceKey)
        ? { kind: 'trash', sourceKey: record.sourceKey, relPath: record.trashRelPath }
        : { kind: 'none' },
    });
  }

  // 5. 用户标记。清除过的产物、导出与占位（`space.purge`）不再出现；扫描到的文件只看文件在不在。
  for (const [id, { entry, location }] of out) {
    const mark = input.mark(entry.id);
    if (mark.dismissedAt && location.kind !== 'source') {
      out.delete(id);
      continue;
    }
    entry.user = { favorite: mark.favorite, displayName: mark.displayName, trashedAt: mark.trashedAt };
    if (mark.displayName) entry.name = mark.displayName;
  }
  return out;
}

/** 流程新建的视频（完成了的 `create` 步骤的产出）；没有时 null。 */
function createdVideoOf(job: SpaceJobFacts): Id | null {
  const step = job.pipeline?.steps?.find((s) => s.name === 'create' && s.status === 'completed');
  const videoId = step?.output?.videoId;
  return typeof videoId === 'string' ? videoId : null;
}

function originOf(job: SpaceJobFacts, videoProject: Id | null, input: DeriveInput): SpaceEntryOrigin {
  const submitter = job.submitter;
  const conversation = submitter.kind === 'agent' ? { conversationId: submitter.id, taskId: submitter.taskId } : {};
  const projectId = videoProject ?? (submitter.kind === 'agent' ? input.projectOfConversation(submitter.id) : null);
  return {
    source: job.kind === 'export' ? 'exported' : 'generated',
    projectId,
    ...(job.videoId ? { videoId: job.videoId } : {}),
    ...(job.export ? { videoRevision: job.export.videoRevision } : {}),
    ...conversation,
    jobId: job.jobId,
    capability: job.kind,
    ...(job.kind !== 'export' ? { provider: { providerId: job.providerId, modelId: job.modelId } } : {}),
  };
}

function placeholder(job: SpaceJobFacts, status: 'generating' | 'failed', origin: SpaceEntryOrigin): DerivedEntry {
  const name = job.kind === 'export' ? (job.export?.destination.files[0] ?? RcSpace.labelExport().text) : labelOf(job.kind)!;
  return {
    entry: {
      id: job.jobId,
      kind: kindOfJob(job),
      name,
      fileName: name,
      source: { projectId: null, conversationId: null },
      relPath: name,
      size: 0,
      lastActivityAt: job.updatedAt,
      status,
      statusDetail:
        status === 'failed'
          ? { reason: job.error?.message ?? RcSpace.taskNotFinished().text, ...(job.error?.code ? { code: job.error.code } : {}) }
          : job.progress
            ? { progress: { done: job.progress.done, total: job.progress.total } }
            : {},
      user: { favorite: false, displayName: null, trashedAt: null },
      ref: { jobId: job.jobId },
      origin,
    },
    location: { kind: 'none' },
  };
}

/** 直接任务另存在保存位置的副本（§7.9）：还在时记进条目的 `file`。 */
function savedCopy(derived: DerivedEntry, input: DeriveInput, file: string | undefined): void {
  if (file && input.pathStat(file) !== null) derived.entry.file = { path: file };
}

function artifactEntry(
  job: SpaceJobFacts,
  artifactId: string,
  kind: SpaceEntryKind,
  fileName: string,
  file: FileStat | null | undefined,
  byteLength: number,
  origin: SpaceEntryOrigin,
  media: SpaceEntry['media'],
): DerivedEntry {
  return {
    entry: {
      id: artifactId,
      kind,
      name: fileName,
      fileName,
      source: { projectId: null, conversationId: null },
      relPath: fileName,
      size: file?.size ?? byteLength,
      lastActivityAt: job.endedAt ?? job.updatedAt,
      status: file === null ? 'missing' : null,
      ...(file === null ? { statusDetail: { reason: RcSpace.outputFileGone().text } } : {}),
      user: { favorite: false, displayName: null, trashedAt: null },
      ref: { artifactId },
      origin,
      ...(media ? { media } : {}),
    },
    location: file ? { kind: 'artifact', artifactId, path: file.path } : { kind: 'none' },
  };
}

function addExport(
  out: Map<Id, DerivedEntry>,
  input: DeriveInput,
  job: SpaceJobFacts,
  output: GeneratedOutput,
  origin: SpaceEntryOrigin,
  video: KnownVideo | null,
): void {
  if (!output.path) return;
  const kind = job.export ? exportKind(job.export.settings) : (input.classify(path.basename(output.path)) ?? 'document');
  const frozen = job.export?.videoRevision ?? null;
  const status = (): { status: SpaceEntryStatus; statusDetail?: SpaceEntry['statusDetail'] } =>
    video && frozen !== null && video.revision !== frozen
      ? { status: 'source-changed', statusDetail: { currentRevision: video.revision } }
      : { status: 'published' };
  // 发布到某个来源目录里：与扫描到的那个文件是同一个条目。
  for (const source of input.sources.values()) {
    const rel = relativeInside(source, output.path);
    if (rel === null) continue;
    const id = input.entryIdOf(source.key, rel);
    const scanned = out.get(id);
    if (scanned) {
      Object.assign(scanned.entry, {
        kind,
        ref: { artifactId: output.artifactId },
        origin,
        media: mediaOf(output),
        file: { path: output.path },
        ...status(),
      });
      return;
    }
    // 扫描里没有：被删掉了，或在扫描不进的目录里。
    const stat = input.pathStat(output.path);
    if (stat === null) {
      out.set(
        output.artifactId,
        exportEntry(job, output, kind, origin, null, { status: 'missing', statusDetail: { reason: RcSpace.exportedFileGone().text } }),
      );
      return;
    }
    break;
  }
  const stat = input.pathStat(output.path);
  out.set(
    output.artifactId,
    exportEntry(
      job,
      output,
      kind,
      origin,
      stat ?? null,
      stat === null ? { status: 'missing', statusDetail: { reason: RcSpace.exportedFileGone().text } } : status(),
    ),
  );
}

function exportEntry(
  job: SpaceJobFacts,
  output: GeneratedOutput,
  kind: SpaceEntryKind,
  origin: SpaceEntryOrigin,
  stat: FileStat | null,
  state: { status: SpaceEntryStatus; statusDetail?: SpaceEntry['statusDetail'] },
): DerivedEntry {
  const fileName = path.basename(output.path!);
  return {
    entry: {
      id: output.artifactId,
      kind,
      name: fileName,
      fileName,
      source: { projectId: null, conversationId: null },
      relPath: fileName,
      size: stat?.size ?? output.byteLength,
      lastActivityAt: job.endedAt ?? job.updatedAt,
      ...state,
      user: { favorite: false, displayName: null, trashedAt: null },
      ref: { artifactId: output.artifactId },
      origin,
      media: mediaOf(output),
      ...(stat ? { file: { path: output.path! } } : {}),
    },
    location: stat ? { kind: 'file', path: output.path! } : { kind: 'none' },
  };
}

/** 文件在来源目录里时，相对它的路径（`/` 分隔）。 */
function relativeInside(source: DeriveSource, file: string): string | null {
  for (const root of new Set([source.realRoot, source.root])) {
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return null;
}

export function exportKind(settings: ExportSettings): SpaceEntryKind {
  switch (settings.kind) {
    case 'subtitles':
      return 'subtitle';
    case 'transcript':
      return 'document';
    case 'audio':
      return 'audio';
    case 'video':
      return 'export';
    default:
      return 'package';
  }
}

function kindOfJob(job: SpaceJobFacts): SpaceEntryKind {
  switch (job.kind) {
    case 'synthesizeSpeech':
      return 'audio';
    case 'generateImage':
      return 'image';
    case 'export':
      return job.export ? exportKind(job.export.settings) : 'document';
    default:
      return 'document';
  }
}

function mediaOf(output: GeneratedOutput): SpaceEntry['media'] {
  const media: NonNullable<SpaceEntry['media']> = { mediaType: output.mediaType };
  if (output.media.kind === 'image') Object.assign(media, { width: output.media.width, height: output.media.height });
  else if (output.media.kind === 'video')
    Object.assign(media, { durationSec: output.media.durationSec, width: output.media.width, height: output.media.height });
  else if ('durationSec' in output.media) media.durationSec = output.media.durationSec;
  return media;
}

function extensionOf(output: GeneratedOutput, file: FileStat | null | undefined): string {
  if (file) return path.extname(file.path).slice(1);
  const sub = output.mediaType.split('/')[1] ?? 'bin';
  return sub === 'mpeg' ? 'mp3' : sub === 'jpeg' ? 'jpg' : sub.replace(/^x-/, '');
}

/** 产物条目的文件名：能力与完成时间（不用提示词或原文：生成参数只在 Job 记录里）。 */
function fileNameOf(job: SpaceJobFacts, ext: string, index: number | null): string {
  const at = (job.endedAt ?? job.createdAt)
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `${labelOf(job.kind)}-${at}${index !== null ? `-${index}` : ''}.${ext}`;
}
