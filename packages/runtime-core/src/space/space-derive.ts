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
 *   无项目会话放进项目之前发布在它工作目录里的（`DeriveSource.formerRoots`），按搬进项目之后的位置认。
 *   智能体内部检查用的导出（`purpose: 'preview'`）不成条，发布的文件扫描到了也不列。
 *   发布到来源目录之外的导出单独成条，`id` 是 artifactId。文件到文件的流程（文件转码、字幕文件的翻译，§7.9）发布的文件同样处理，
 *   来源是 `generated`，`capability` 是流程名，带执行者。智能体用 `downloads_save` 交出的文件（§3.5）同样处理，`capability`
 *   是 `downloads-save`，不带服务商。
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
  /** 索引文件夹（检索规格 §9.1）：只读的来源，条目的 `source.folderId`。 */
  folderId?: Id | null;
  /**
   * 项目来源：放进这个项目的无项目会话原来的工作目录（架构设计 §3.10）。绑定前发布在那里的导出记着旧路径，东西已经按相对路径
   * 原样搬进项目，按这里换算回项目里的那个文件。
   */
  formerRoots?: readonly string[];
}

export interface ScannedFile {
  relPath: string;
  kind: SpaceEntryKind;
  size: number;
  mtimeMs: number;
  birthtimeMs?: number;
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
  birthtimeMs?: number;
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
    case 'generateMusic':
      return RcSpace.labelGenerateMusic().text;
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
  // 内部检查用的导出发布在来源目录里的文件：等任务都过完，没有被交付的导出认领的才去掉。
  const previews = new Set<Id>();

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
      source: { projectId: source.projectId, conversationId: source.conversationId, ...(source.folderId ? { folderId: source.folderId } : {}) },
      relPath: item.file.relPath,
      size: item.file.size,
      lastActivityAt: new Date(item.file.mtimeMs).toISOString(),
      createdAt: birthTime(item.file),
      updatedAt: new Date(item.file.mtimeMs).toISOString(),
      status: null,
      user: { favorite: false, displayName: null, trashedAt: null },
    };
    const derived: DerivedEntry = { entry, location: { kind: 'source', sourceKey: item.sourceKey, relPath: item.file.relPath } };
    if (item.file.kind === 'video') {
      const dir = path.join(source.root, ...item.file.relPath.split('/'));
      derived.videoDir = dir;
      const known = input.videoAt(dir);
      if (known) {
        if (known.name.trim()) entry.name = known.name;
        entry.ref = { videoId: known.videoId };
        entry.statusDetail = { currentRevision: known.revision };
        // 「时长或尺寸」一列：工作稿根序列的时长与画布尺寸（索引读到之后；快照不全时没有）。
        const timeline = known.facts.timeline;
        if (timeline) entry.media = { durationSec: timeline.durationSec, width: timeline.width, height: timeline.height };
        // 派生的子视频（`videos.derive`）：来源是父视频、派生时它的版本与取的区间。
        const derivedFrom = known.facts.origin;
        if (derivedFrom) {
          entry.origin = {
            source: 'derived',
            projectId: source.projectId,
            videoId: derivedFrom.parentVideoId,
            videoRevision: derivedFrom.parentRevision,
            range: { start: derivedFrom.range.start, end: derivedFrom.range.end },
            capability: 'videos-derive',
          };
        }
        // 同一部视频在项目里也在索引文件夹里：按项目那一份（扫描顺序会变，不能靠先到先得）。
        const seen = videos.get(known.videoId);
        if (!seen || (seen.source.folderId && !source.folderId)) videos.set(known.videoId, { entryId: id, source, known });
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
        createdAt: record.importedAt,
        updatedAt: null,
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
    // 写作类 AI 工具的正文（产品设计 §5.10，创作辅助集成设计 §3.4）：一份 Markdown 文档条目，带出处旁文件。
    const writing = job.kind === 'pipeline' ? job.pipeline?.document : undefined;
    if (writing && job.result) {
      const video = job.videoId ? (videos.get(job.videoId) ?? null) : null;
      const origin: SpaceEntryOrigin = { ...originOf(job, video?.source.projectId ?? null, input), capability: job.pipeline!.name };
      const file = input.artifactFile(job.result.artifactId);
      const name = `${writingLabelOf(writing.tool)}-${stampOf(job)}.md`;
      const derived = artifactEntry(job, job.result.artifactId, 'document', name, file, writing.byteLength, origin, { mediaType: 'text/markdown' });
      if (writing.citationsArtifactId) derived.entry.citations = { artifactId: writing.citationsArtifactId };
      out.set(job.result.artifactId, derived);
      continue;
    }
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
        // `downloads_save` 交出的文件（§3.5）：智能体自己复制的，没有服务商与模型。
        if (job.pipeline!.name === 'downloads-save') delete origin.provider;
        for (const output of job.result.outputs ?? []) {
          const download = job.pipeline?.name === 'link-import';
          const projectId = job.pipeline?.params?.projectId;
          const assigned = download ? { ...origin, source: 'imported' as const, projectId: output.media.kind === 'text' && typeof projectId === 'string' ? projectId : null } : origin;
          const derived = addExport(out, input, job, output, assigned, null);
          // 智能体交出的带出处的 Markdown（创作辅助集成设计 §3.4「智能体路径」）：条目带出处旁文件。
          const citations = job.pipeline?.citationsArtifactId;
          if (derived && citations) derived.entry.citations = { artifactId: citations };
        }
      }
      continue;
    }
    if (job.kind === 'transcribe' || labelOf(job.kind) === null) continue;
    // 内部检查用的导出：排队、失败与完成都不成条。
    if (job.kind === 'export' && job.export?.settings.purpose === 'preview') {
      for (const output of job.result?.outputs ?? []) hidePreview(previews, input, output);
      continue;
    }
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

  // 内部检查用的导出发布的文件：没有被交付的导出认领（同一路径后来又交付过）、也不是视频目录的，不列。
  for (const id of previews) if (!out.get(id)?.entry.ref) out.delete(id);

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
        createdAt: null,
        updatedAt: null,
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
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
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
      createdAt: job.endedAt ?? job.createdAt,
      updatedAt: file ? new Date(file.mtimeMs).toISOString() : job.endedAt ?? job.updatedAt,
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
): DerivedEntry | null {
  if (!output.path) return null;
  const kind = job.export ? exportKind(job.export.settings) : (input.classify(path.basename(output.path)) ?? 'document');
  const frozen = job.export?.videoRevision ?? null;
  const status = (): { status: SpaceEntryStatus; statusDetail?: SpaceEntry['statusDetail'] } =>
    video && frozen !== null && video.revision !== frozen
      ? { status: 'source-changed', statusDetail: { currentRevision: video.revision } }
      : { status: 'published' };
  // 发布到某个来源目录里：与扫描到的那个文件是同一个条目。
  for (const { source, inside } of sourcesOf(input, output.path)) {
    const { rel, former } = inside;
    const id = input.entryIdOf(source.key, rel);
    const scanned = out.get(id);
    if (scanned) {
      Object.assign(scanned.entry, {
        kind,
        ref: { artifactId: output.artifactId },
        origin,
        media: mediaOf(output),
        file: { path: former ? path.join(source.realRoot, ...rel.split('/')) : output.path },
        ...status(),
      });
      return scanned;
    }
    // 扫描里没有：被删掉了，或在扫描不进的目录里。
    const stat = input.pathStat(output.path);
    if (stat === null) {
      const missing = exportEntry(job, output, kind, origin, null, { status: 'missing', statusDetail: { reason: RcSpace.exportedFileGone().text } });
      out.set(output.artifactId, missing);
      return missing;
    }
    break;
  }
  const stat = input.pathStat(output.path);
  const derived = exportEntry(
    job,
    output,
    kind,
    origin,
    stat ?? null,
    stat === null ? { status: 'missing', statusDetail: { reason: RcSpace.exportedFileGone().text } } : status(),
  );
  out.set(output.artifactId, derived);
  return derived;
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
      createdAt: birthTime(stat) ?? job.endedAt ?? job.createdAt,
      updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : job.endedAt ?? job.updatedAt,
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

/** 文件在来源目录里时，相对它的路径（`/` 分隔）；`former`：按放进项目之前的旧工作目录认出来的。 */
function relativeInside(source: DeriveSource, file: string): { rel: string; former: boolean } | null {
  const current = new Set([source.realRoot, source.root]);
  for (const root of [...current, ...(source.formerRoots ?? [])]) {
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { rel: rel.split(path.sep).join('/'), former: !current.has(root) };
  }
  return null;
}

/** 内部检查用的导出（`purpose: 'preview'`，架构设计 §9.13）：不成条；发布在来源目录里的文件记下来，不作普通文件列出。 */
function hidePreview(previews: Set<Id>, input: DeriveInput, output: GeneratedOutput): void {
  if (!output.path) return;
  for (const { source, inside } of sourcesOf(input, output.path)) previews.add(input.entryIdOf(source.key, inside.rel));
}

/**
 * 含着这个文件的来源，最近的在前：索引文件夹可以包含项目（扫描时跳过项目那一块），项目里的文件按项目认。
 */
function sourcesOf(input: DeriveInput, file: string): { source: DeriveSource; inside: { rel: string; former: boolean } }[] {
  const found: { source: DeriveSource; inside: { rel: string; former: boolean } }[] = [];
  for (const source of input.sources.values()) {
    const inside = relativeInside(source, file);
    if (inside) found.push({ source, inside });
  }
  return found.sort((a, b) => a.inside.rel.length - b.inside.rel.length);
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
    case 'generateMusic':
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
  return `${labelOf(job.kind)}-${stampOf(job)}${index !== null ? `-${index}` : ''}.${ext}`;
}

/** 文件名里的完成时间：`20261012-083000`。 */
function stampOf(job: SpaceJobFacts): string {
  return (job.endedAt ?? job.createdAt)
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
}

/** 写作类工具的文档名。 */
function writingLabelOf(tool: string): string {
  switch (tool) {
    case 'summary':
      return RcSpace.labelSummary().text;
    case 'blog':
      return RcSpace.labelBlog().text;
    case 'title':
      return RcSpace.labelTitles().text;
    default:
      return RcSpace.labelDescription().text;
  }
}

/** birthtime 不可用时不以 ctime 或修改时间冒充创建时间。 */
function birthTime(stat: { birthtimeMs?: number } | null): string | null {
  const at = stat?.birthtimeMs;
  return at !== undefined && Number.isFinite(at) && at > 0 ? new Date(at).toISOString() : null;
}
