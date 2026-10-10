import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RpcError,
  type DirectoryEvent,
  type DirectorySnapshot,
  type JobRecord,
  type Project,
  type SpaceEvent,
  type VideoSnapshot,
} from '@baocut/protocol';
import { TopicLog, silentLogger, type Harness } from '@baocut/harness';
import { SpaceArtifactStore, SpaceMarkStore } from '@baocut/runtime-storage';
import { ArtifactStore, artifactIdOf, toolDefinition } from '@baocut/jobs';
import { SpaceCatalog, type SpaceJobsSource } from '../space-catalog.ts';
import { toolCandidates } from '../tool-catalogue/tool-candidates.ts';
import { ContentIndex, type ContentReader } from './content-index.ts';
import type { ReadContentResult } from './content-extract.ts';
import { materialText, resolvePipelineEntryInputs, withSpeechMaterial, withTextMaterial } from './space-inputs.ts';
import { USER_VIEWER, projectOf, listEntries, searchContent, visibleEntry, type SpaceViewer } from './space-queries.ts';

/**
 * Space 目录的派生、增量、筛选、回收站与物理删除、内容检索的完整度与按主体的过滤。来源目录是临时目录；
 * Job Ledger 与视频的只读查询换成假的（真实引擎的端到端见 `space-e2e.test.ts`）。
 */

class FakeJobs implements SpaceJobsSource {
  records: JobRecord[] = [];
  readonly files = new Map<string, string>();
  readonly #listeners = new Set<(job: JobRecord) => void>();
  readonly artifacts = { locate: async (id: string) => this.files.get(id) ?? null };

  list(): JobRecord[] {
    return structuredClone(this.records).reverse();
  }

  onChange(listener: (job: JobRecord) => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  put(record: JobRecord): void {
    this.records = [...this.records.filter((r) => r.jobId !== record.jobId), record];
    for (const listener of this.#listeners) listener(record);
  }
}

/** 假的只读查询：视频目录（真实路径）→ 内容。 */
class FakeReader implements ContentReader {
  readonly videos = new Map<string, ReadContentResult>();
  readonly failing = new Set<string>();
  reads = 0;

  async peek(dir: string) {
    const found = this.#get(dir);
    return { videoId: found.videoId, name: found.name, revision: found.revision };
  }

  /** 设上时读取要等它放行（模拟慢的引擎）。 */
  hold: Promise<void> | null = null;

  async readContent(dir: string) {
    this.reads++;
    await this.hold;
    return structuredClone(this.#get(dir));
  }

  #get(dir: string): ReadContentResult {
    if (this.failing.has(dir)) throw new Error('UNKNOWN_METHOD');
    const found = this.videos.get(dir);
    if (!found) throw new Error('不是视频');
    return found;
  }
}

let seq = 0;
function job(partial: Partial<JobRecord> & Pick<JobRecord, 'kind' | 'state'>): JobRecord {
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq)).toISOString();
  return {
    jobId: `job_${seq}`,
    phase: 'done',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:c',
    providerId: 'local',
    modelId: 'm',
    bundleId: null,
    inputHash: `sha256:in${seq}`,
    submitter: { kind: 'connection', id: 'c1' },
    attempt: 1,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
    endedAt: partial.state === 'completed' || partial.state === 'failed' ? at : null,
    error: null,
    result: null,
    warnings: [],
    ...partial,
  } as JobRecord;
}

function imageOutput(artifactId: string, assetId: string | null) {
  return { artifactId, mediaType: 'image/png', byteLength: 4, assetId, media: { kind: 'image' as const, width: 2, height: 2 } };
}

function videoContent(
  videoId: string,
  revision: string,
  opts: { used?: string[]; linked?: string; text?: string; timeline?: { width: number; height: number; frames: number } } = {},
): ReadContentResult {
  // 给了 `timeline` 时根序列是完整的（画布、轨道、实例的区间），否则只带内容所需的字段。
  const span = opts.timeline ? { span: { fromFrame: 0, durationFrames: opts.timeline.frames } } : {};
  return {
    videoId,
    name: `视频 ${videoId}`,
    revision,
    snapshot: {
      rootSequenceId: 'seq',
      sequences: {
        seq: {
          id: 'seq',
          fps: { num: 30, den: 1 },
          items: (opts.used ?? []).map((id, i) => ({ id: `i${i}`, type: 'image', assetRef: { id, revision: 'r' }, ...span })),
          markers: [],
          ...(opts.timeline
            ? {
                canvas: { width: opts.timeline.width, height: opts.timeline.height, workingSpace: 'srgb', background: '#000000' },
                tracks: [],
              }
            : {}),
        },
      },
      assets: opts.linked
        ? { linked: { id: 'linked', name: '链接素材', revisions: { r: { storage: { mode: 'linked', locator: { path: opts.linked } } } } } }
        : {},
    } as unknown as VideoSnapshot,
    documents: [
      {
        documentId: 'cap',
        kind: 'caption',
        name: '字幕',
        language: 'zh',
        revision: revision,
        schema: 'baocut.caption/1',
        body: { timescale: 1000, cues: [{ id: 'c1', start: 2000, end: 3000, text: opts.text ?? '今天讲剪辑', speaker: '宝玉' }] },
        plan: null,
      },
    ],
  };
}

/** 带一份转写（与可选的译文）的视频内容：工具候选输入要的文稿事实。 */
function speechContent(videoId: string, revision: string, translationLanguage?: string): ReadContentResult {
  const base = videoContent(videoId, revision);
  const words = [
    { id: 'w1', text: '今天', start: 0, end: 400 },
    { id: 'w2', text: '剪辑。', start: 400, end: 800 },
  ];
  return {
    ...base,
    documents: [
      ...base.documents,
      {
        documentId: `speech-${videoId}`,
        kind: 'speech',
        name: '转写',
        language: 'zh',
        revision,
        schema: 'baocut.speech/1',
        body: { schema: 'baocut.speech/1', timescale: 1000, words, sentences: null },
        plan: null,
      },
      ...(translationLanguage
        ? [
            {
              documentId: `tr-${videoId}`,
              kind: 'translation',
              name: '译文',
              language: translationLanguage,
              revision,
              schema: 'baocut.translation/2',
              sourceDocumentId: `speech-${videoId}`,
              body: { units: [{ id: 'u1', sourceSentenceId: 's-w1', sourceFingerprint: 'sha256:old', naturalText: 'Editing today.' }] },
              plan: null,
            },
          ]
        : []),
    ],
  };
}

describe('Space 目录', () => {
  let tmp: string;
  let projectDir: string;
  let otherDir: string;
  let videoDir: string;
  let project: Project;
  let directory: TopicLog<DirectorySnapshot, DirectoryEvent>;
  let jobs: FakeJobs;
  let reader: FakeReader;
  let marks: SpaceMarkStore;
  let catalogs: SpaceCatalog[];

  const harness = () =>
    ({ subscribe: (_topic: string, after: string | undefined, l: never) => directory.subscribe(after, l) }) as unknown as Harness;

  async function open(
    indexDir = path.join(tmp, 'cache', 'content-index'),
    artifacts?: SpaceArtifactStore,
  ): Promise<{ catalog: SpaceCatalog; index: ContentIndex }> {
    const index = new ContentIndex({ dir: indexDir, reader, log: silentLogger });
    await index.load();
    const catalog = new SpaceCatalog({
      harness: harness(),
      marks,
      log: silentLogger,
      watch: false,
      jobs,
      index,
      ...(artifacts ? { artifacts } : {}),
    });
    catalogs.push(catalog);
    catalog.start();
    await catalog.ready;
    await catalog.idle();
    return { catalog, index };
  }

  const byName = (catalog: SpaceCatalog, name: string) => catalog.entries().find((e) => e.fileName === name || e.name === name)!;

  /** 内容索引的库里记着的视频数。 */
  const storedVideos = (indexDir: string): number => {
    const db = new DatabaseSync(path.join(indexDir, 'index.db'), { readOnly: true });
    try {
      return (db.prepare('SELECT count(*) AS n FROM videos').get() as { n: number }).n;
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'space-catalog-')));
    projectDir = path.join(tmp, 'proj');
    otherDir = path.join(tmp, 'elsewhere');
    videoDir = path.join(projectDir, '访谈');
    await fs.mkdir(path.join(projectDir, 'raw'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'exports'), { recursive: true });
    await fs.mkdir(videoDir, { recursive: true });
    await fs.mkdir(otherDir, { recursive: true });
    await fs.writeFile(path.join(videoDir, 'video.db'), 'db');
    await fs.writeFile(path.join(projectDir, 'raw', 'clip.mp4'), 'mp4');
    await fs.writeFile(path.join(projectDir, 'cover.png'), 'png');
    project = { id: 'p1', name: '项目', path: projectDir, createdAt: '', lastActiveAt: '', pinned: false, archived: false };
    directory = new TopicLog<DirectorySnapshot, DirectoryEvent>(() => ({ projects: [project], conversations: [] }), '0');
    jobs = new FakeJobs();
    reader = new FakeReader();
    reader.videos.set(videoDir, videoContent('v1', 'rev-1', { used: ['asset-applied'], linked: '../raw/clip.mp4' }));
    marks = new SpaceMarkStore(path.join(tmp, 'space.json'));
    await marks.load();
    catalogs = [];
  });

  afterEach(async () => {
    for (const catalog of catalogs) await catalog.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('文件与视频的创建时间独立于更新时间；视频的 WAL 写入计入更新时间', async () => {
    const imagePath = path.join(projectDir, 'cover.png');
    const dbPath = path.join(videoDir, 'video.db');
    const updated = new Date('2026-01-01T10:00:00Z');
    const walUpdated = new Date('2026-01-01T11:00:00Z');
    await fs.utimes(imagePath, updated, updated);
    await fs.utimes(dbPath, updated, updated);
    await fs.writeFile(`${dbPath}-wal`, 'wal');
    await fs.utimes(`${dbPath}-wal`, walUpdated, walUpdated);
    const { catalog } = await open();
    const image = byName(catalog, 'cover.png');
    const video = byName(catalog, '访谈');
    const birth = (stat: { birthtimeMs: number }) => stat.birthtimeMs > 0 ? new Date(stat.birthtimeMs).toISOString() : null;
    expect(image.createdAt).toBe(birth(await fs.stat(imagePath)));
    expect(image.updatedAt).toBe(updated.toISOString());
    expect(video.createdAt).toBe(birth(await fs.stat(dbPath)));
    expect(video.updatedAt).toBe(walUpdated.toISOString());
    const created = image.createdAt;
    await fs.utimes(imagePath, walUpdated, walUpdated);
    await catalog.rescan();
    expect(byName(catalog, 'cover.png').createdAt).toBe(created);
    expect(byName(catalog, 'cover.png').updatedAt).toBe(walUpdated.toISOString());
  });

  it('生成占位与产物提供创建、更新时间，产物的文件修改不冒充创建时间', async () => {
    const createdAt = '2026-01-01T09:00:00.000Z';
    const updatedAt = '2026-01-01T10:00:00.000Z';
    const running = job({ kind: 'generateImage', state: 'running', createdAt, updatedAt });
    jobs.records = [running];
    const { catalog } = await open();
    expect(catalog.entries().find((e) => e.id === running.jobId)).toMatchObject({ createdAt, updatedAt });
    const file = path.join(otherDir, 'generated.png');
    await fs.writeFile(file, 'png');
    const editedAt = '2026-01-01T12:00:00.000Z';
    await fs.utimes(file, new Date(editedAt), new Date(editedAt));
    const artifactId = 'sha256:timestamps';
    jobs.files.set(artifactId, file);
    jobs.put({ ...running, state: 'completed', endedAt: updatedAt, result: {
      artifactId, outputs: [imageOutput(artifactId, null)], documentId: null,
    } } as JobRecord);
    await catalog.idle();
    expect(catalog.entries().find((e) => e.id === artifactId)).toMatchObject({ createdAt: updatedAt, updatedAt: editedAt });
  });

  /** 一组覆盖各种派生状态的任务。 */
  async function seedJobs(): Promise<{ applied: string; candidate: string; exported: string }> {
    const art = path.join(tmp, 'artifacts');
    await fs.mkdir(art, { recursive: true });
    for (const id of ['sha256:aa', 'sha256:bb']) {
      const file = path.join(art, `${id.slice(7)}.png`);
      await fs.writeFile(file, 'png!');
      jobs.files.set(id, file);
    }
    const srt = path.join(projectDir, 'exports', '访谈.srt');
    await fs.writeFile(srt, '1\n');
    jobs.put(
      job({
        kind: 'generateImage',
        state: 'completed',
        videoId: 'v1',
        result: {
          documentId: null,
          artifactId: 'sha256:aa',
          outputs: [imageOutput('sha256:aa', 'asset-applied'), imageOutput('sha256:bb', 'asset-other')],
        },
      }),
    );
    jobs.put(
      job({
        kind: 'export',
        state: 'completed',
        videoId: 'v1',
        export: {
          settings: { kind: 'subtitles', format: 'srt' } as never,
          snapshotArtifactId: 'sha256:snap',
          videoRevision: 'rev-1',
          sequenceId: 'seq',
          destination: { dir: path.join(projectDir, 'exports'), files: ['访谈.srt'], overwrite: false },
        },
        result: {
          documentId: null,
          artifactId: 'sha256:srt',
          outputs: [
            {
              artifactId: 'sha256:srt',
              mediaType: 'application/x-subrip',
              byteLength: 2,
              assetId: null,
              media: { kind: 'text', entries: 1, durationSec: 3 },
              path: srt,
            },
          ],
        },
      }),
    );
    jobs.put(job({ kind: 'synthesizeSpeech', state: 'running', videoId: 'v1', progress: { done: 1, total: 3 } as never }));
    jobs.put(job({ kind: 'generateImage', state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID', message: '模型没有给出图片' } }));
    jobs.put(job({ kind: 'transcribe', state: 'completed', videoId: 'v1', result: { documentId: 'd', artifactId: 'sha256:raw' } }));
    return { applied: 'sha256:aa', candidate: 'sha256:bb', exported: srt };
  }

  it('成片导出：派生为 export 条目，带上 ffprobe 读到的时长与尺寸', async () => {
    const mp4 = path.join(projectDir, 'exports', '访谈.mp4');
    await fs.writeFile(mp4, 'mp4!');
    jobs.put(
      job({
        kind: 'export',
        state: 'completed',
        videoId: 'v1',
        export: {
          settings: { kind: 'video', format: 'mp4' } as never,
          snapshotArtifactId: 'sha256:snap',
          videoRevision: 'rev-1',
          sequenceId: 'seq',
          destination: { dir: path.join(projectDir, 'exports'), files: ['访谈.mp4'], overwrite: false },
        },
        result: {
          documentId: null,
          artifactId: 'sha256:mp4',
          outputs: [
            {
              artifactId: 'sha256:mp4',
              mediaType: 'video/mp4',
              byteLength: 4,
              assetId: null,
              media: {
                kind: 'video',
                durationSec: 4,
                width: 320,
                height: 180,
                videoCodec: 'h264',
                audioCodec: 'aac',
                frames: 120,
                fps: '30/1',
              },
              path: mp4,
            },
          ],
        },
      }),
    );
    const { catalog } = await open();
    expect(byName(catalog, '访谈.mp4')).toMatchObject({
      kind: 'export',
      status: 'published',
      relPath: 'exports/访谈.mp4',
      ref: { artifactId: 'sha256:mp4' },
      origin: { source: 'exported', videoId: 'v1' },
      media: { mediaType: 'video/mp4', durationSec: 4, width: 320, height: 180 },
    });
  });

  it('派生：扫描、产物、导出与占位的状态；重建与从头再建结果一致，用户标记不丢', async () => {
    await seedJobs();
    const { catalog } = await open();
    const video = byName(catalog, '访谈');
    expect(video).toMatchObject({ kind: 'video', ref: { videoId: 'v1' }, status: null, source: { projectId: 'p1' } });
    expect(catalog.get('sha256:aa')).toMatchObject({
      kind: 'image',
      status: 'applied',
      origin: { source: 'generated', projectId: 'p1', videoId: 'v1' },
    });
    expect(catalog.get('sha256:bb')).toMatchObject({ status: 'candidate', source: { projectId: null, conversationId: null } });
    const srt = byName(catalog, '访谈.srt');
    expect(srt).toMatchObject({ kind: 'subtitle', status: 'published', relPath: 'exports/访谈.srt', ref: { artifactId: 'sha256:srt' } });
    expect(catalog.entries().filter((e) => e.status === 'generating')).toEqual([
      expect.objectContaining({ kind: 'audio', statusDetail: { progress: { done: 1, total: 3 } } }),
    ]);
    expect(catalog.entries().filter((e) => e.status === 'failed')).toEqual([
      expect.objectContaining({ statusDetail: { reason: '模型没有给出图片', code: 'MODEL_OUTPUT_INVALID' } }),
    ]);
    // 转写的原始结果不是可交付的产物。
    expect(catalog.entries().some((e) => JSON.stringify(e).includes('sha256:raw'))).toBe(false);

    await catalog.update({ entryId: 'sha256:aa', favorite: true, displayName: '封面图' });
    const before = catalog.entries();
    const events: SpaceEvent[] = [];
    catalog.subscribe(undefined, (e) => events.push(e.event));
    const rebuilt = await catalog.rebuild();
    expect(rebuilt.entries).toBe(before.length);
    await catalog.idle();
    expect(catalog.entries()).toEqual(before);
    expect(catalog.get('sha256:aa')).toMatchObject({ name: '封面图', user: { favorite: true } });
    expect(events.filter((e) => e.type === 'catalog.replaced')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'entry.removed')).toEqual([]);
    expect(reader.reads).toBeGreaterThanOrEqual(2);

    // 丢掉内容索引的缓存，从头再建一个目录：同样的结果。
    const { catalog: fresh } = await open(path.join(tmp, 'cache', 'other-index'));
    expect(fresh.entries()).toEqual(before);
  });

  it('增量：Job 事件与视频版本变化逐条更新', async () => {
    const { catalog, index } = await open();
    const events: SpaceEvent[] = [];
    catalog.subscribe(undefined, (e) => events.push(e.event));
    const running = job({ kind: 'generateImage', state: 'running', videoId: 'v1' });
    jobs.put(running);
    await catalog.idle();
    expect(events).toEqual([{ type: 'entry.upsert', entry: expect.objectContaining({ id: running.jobId, status: 'generating' }) }]);

    events.length = 0;
    const file = path.join(tmp, 'img.png');
    await fs.writeFile(file, 'png');
    jobs.files.set('sha256:new', file);
    jobs.put({
      ...running,
      state: 'completed',
      result: { documentId: null, artifactId: 'sha256:new', outputs: [imageOutput('sha256:new', 'asset-new')] },
    });
    await catalog.idle();
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'entry.upsert', entry: expect.objectContaining({ id: 'sha256:new', status: 'candidate' }) },
        { type: 'entry.removed', entryId: running.jobId },
      ]),
    );

    // 视频提交了新版本，时间线用上了这张图：重新索引后变成 applied。
    events.length = 0;
    reader.videos.set(videoDir, videoContent('v1', 'rev-2', { used: ['asset-new'] }));
    index.touched(videoDir, 'rev-2');
    await catalog.idle();
    expect(catalog.get('sha256:new').status).toBe('applied');
    expect(events).toContainEqual({ type: 'entry.upsert', entry: expect.objectContaining({ id: 'sha256:new', status: 'applied' }) });

    // 失败的占位：同样的输入后来成功了就不再显示。
    const failed = job({ kind: 'synthesizeSpeech', state: 'failed', inputHash: 'sha256:same' });
    jobs.put(failed);
    await catalog.idle();
    expect(catalog.get(failed.jobId).status).toBe('failed');
    jobs.put(
      job({
        kind: 'synthesizeSpeech',
        state: 'completed',
        inputHash: 'sha256:same',
        result: { documentId: null, artifactId: 'sha256:gone', outputs: [] },
      }),
    );
    await catalog.idle();
    expect(() => catalog.get(failed.jobId)).toThrow(RpcError);
  });

  it('导出之后视频改了是 source-changed；导出的文件不在了是 missing', async () => {
    const { exported } = await seedJobs();
    const { catalog, index } = await open();
    reader.videos.set(videoDir, videoContent('v1', 'rev-9', { used: ['asset-applied'] }));
    index.touched(videoDir, 'rev-9');
    await catalog.idle();
    expect(byName(catalog, '访谈.srt')).toMatchObject({ status: 'source-changed', statusDetail: { currentRevision: 'rev-9' } });
    expect(catalog.openForEdit(byName(catalog, '访谈.srt').id)).toMatchObject({
      mode: 'source-video',
      videoId: 'v1',
      target: { entryId: byName(catalog, '访谈').id },
      frozenRevision: 'rev-1',
      currentRevision: 'rev-9',
      changed: true,
    });
    expect(catalog.openForEdit(byName(catalog, '访谈').id)).toMatchObject({ mode: 'video', videoId: 'v1' });
    expect(catalog.openForEdit(byName(catalog, 'cover.png').id)).toMatchObject({ mode: 'new-video', projectId: 'p1' });

    await fs.rm(exported);
    await catalog.rescan();
    expect(catalog.get('sha256:srt')).toMatchObject({ status: 'missing', kind: 'subtitle' });
  });

  it('list 的筛选与分页', async () => {
    await seedJobs();
    const { catalog } = await open();
    await catalog.update({ entryId: byName(catalog, 'cover.png').id, trashed: true });
    await catalog.update({ entryId: 'sha256:bb', favorite: true });
    const all = listEntries(catalog, USER_VIEWER, { trash: 'include' });
    expect(all.total).toBe(catalog.entries().length);

    const kinds = (p: Parameters<typeof listEntries>[2]) => listEntries(catalog, USER_VIEWER, p).entries.map((e) => e.name ?? e.fileName);
    expect(kinds({ trash: 'only' })).toEqual(['cover.png']);
    expect(listEntries(catalog, USER_VIEWER, {}).entries.some((e) => e.fileName === 'cover.png')).toBe(false);
    expect(
      listEntries(catalog, USER_VIEWER, { kind: 'image', status: ['applied', 'candidate'] })
        .entries.map((e) => e.id)
        .sort(),
    ).toEqual(['sha256:aa', 'sha256:bb']);
    expect(listEntries(catalog, USER_VIEWER, { kind: 'image' }).total).toBe(3);
    expect(listEntries(catalog, USER_VIEWER, { status: ['applied', 'candidate'] }).total).toBe(2);
    expect(listEntries(catalog, USER_VIEWER, { status: 'none' }).entries.every((e) => e.status === null)).toBe(true);
    expect(listEntries(catalog, USER_VIEWER, { favorite: true }).entries.map((e) => e.id)).toEqual(['sha256:bb']);
    // 来源视频：视频本身，以及由它生成、导出的条目。
    const fromVideo = listEntries(catalog, USER_VIEWER, { videoId: 'v1' }).entries.map((e) => e.fileName);
    expect(fromVideo).toEqual(expect.arrayContaining(['访谈', '访谈.srt']));
    expect(fromVideo).toHaveLength(5);
    // 不属于项目的：失败的占位（没有视频，也不是会话里提交的）。
    expect(listEntries(catalog, USER_VIEWER, { projectId: null }).entries.map((e) => e.status)).toEqual(['failed']);
    expect(listEntries(catalog, USER_VIEWER, { projectId: 'p1' }).total).toBe(all.total - 2);

    const pages: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listEntries(catalog, USER_VIEWER, { trash: 'include', limit: 2, ...(cursor ? { cursor } : {}) });
      pages.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages).toEqual(all.entries.map((e) => e.id));
  });

  it('物理删除：视频拒绝、进行中拒绝、先进回收站；仍被引用时不删并列出引用', async () => {
    await seedJobs();
    const { catalog } = await open();
    const code = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        return (error as RpcError).details as { code: string };
      }
      throw new Error('应该拒绝');
    };
    expect(await code(() => catalog.purge(byName(catalog, '访谈').id))).toMatchObject({ code: 'SPACE_PURGE_VIDEO' });
    const running = catalog.entries().find((e) => e.status === 'generating')!;
    expect(await code(() => catalog.purge(running.id))).toMatchObject({ code: 'SPACE_PURGE_RUNNING' });
    const clip = byName(catalog, 'clip.mp4');
    expect(await code(() => catalog.purge(clip.id))).toMatchObject({ code: 'SPACE_NOT_TRASHED' });

    // 视频链接着这个文件：不删，返回引用。
    await catalog.update({ entryId: clip.id, trashed: true });
    const blocked = await catalog.purge(clip.id);
    expect(blocked).toEqual({
      status: 'blocked',
      entryId: clip.id,
      references: [expect.objectContaining({ kind: 'video-asset', videoId: 'v1', assetId: 'linked' })],
    });
    await expect(fs.stat(path.join(projectDir, 'raw', 'clip.mp4'))).resolves.toBeTruthy();

    // 视频此刻读不了：无法确认，按有引用处理。
    const cover = byName(catalog, 'cover.png');
    await catalog.update({ entryId: cover.id, trashed: true });
    reader.failing.add(videoDir);
    const { index } = { index: catalog.index! };
    index.touched(videoDir, 'rev-x');
    await catalog.idle();
    expect(await catalog.purge(cover.id)).toMatchObject({ status: 'blocked', references: [{ kind: 'unverified' }] });
    reader.failing.delete(videoDir);
    index.touched(videoDir, 'rev-y');
    await catalog.idle();
    expect(await catalog.purge(cover.id)).toEqual({ status: 'purged', entryId: cover.id });
    await expect(fs.stat(path.join(projectDir, 'cover.png'))).rejects.toThrow();
    expect(() => catalog.get(cover.id)).toThrow(RpcError);

    // 产物：删掉产物库里的文件，之后不以「缺失」出现。
    await catalog.update({ entryId: 'sha256:bb', trashed: true });
    expect(await catalog.purge('sha256:bb')).toMatchObject({ status: 'purged' });
    await expect(fs.stat(jobs.files.get('sha256:bb')!)).rejects.toThrow();
    await catalog.rescan();
    expect(() => catalog.get('sha256:bb')).toThrow(RpcError);

    // 导出发布到项目里的文件：删掉之后，导出也不以「缺失」出现。
    const srt = byName(catalog, '访谈.srt');
    await catalog.update({ entryId: srt.id, trashed: true });
    expect(await catalog.purge(srt.id)).toMatchObject({ status: 'purged' });
    await catalog.rescan();
    expect(() => catalog.get('sha256:srt')).toThrow(RpcError);

    // 失败的占位直接清除。
    const failed = catalog.entries().find((e) => e.status === 'failed')!;
    expect(await catalog.purge(failed.id)).toMatchObject({ status: 'purged' });
    expect(() => catalog.get(failed.id)).toThrow(RpcError);
  });

  it('登记项目素材：项目里的原地登记，项目外的复制进 imports/', async () => {
    const { catalog } = await open();
    await fs.writeFile(path.join(projectDir, 'raw', 'note.md'), '# 笔记');
    const inside = await catalog.importFile({ projectId: 'p1', file: path.join(projectDir, 'raw', 'note.md'), name: '拍摄笔记' });
    expect(inside).toMatchObject({
      copied: false,
      entry: { relPath: 'raw/note.md', name: '拍摄笔记', origin: { source: 'imported', projectId: 'p1' } },
    });

    const outside = path.join(otherDir, 'logo.png');
    await fs.writeFile(outside, 'png');
    const first = await catalog.importFile({ projectId: 'p1', file: outside });
    const second = await catalog.importFile({ projectId: 'p1', file: outside });
    expect(first).toMatchObject({ copied: true, entry: { relPath: 'imports/logo.png', kind: 'image' } });
    expect(second.entry.relPath).toBe('imports/logo (2).png');

    await expect(catalog.importFile({ projectId: 'p1', file: path.join(videoDir, 'video.db') })).rejects.toThrow(RpcError);
    await fs.writeFile(path.join(otherDir, 'x.exe'), '');
    await expect(catalog.importFile({ projectId: 'p1', file: path.join(otherDir, 'x.exe') })).rejects.toMatchObject({
      details: { code: 'SPACE_IMPORT_UNSUPPORTED' },
    });
    await expect(catalog.importFile({ projectId: 'nope', file: outside })).rejects.toMatchObject({ code: 'not-found' });

    // 登记的文件不在了：条目留下，状态 missing。
    await fs.rm(path.join(projectDir, 'raw', 'note.md'));
    await catalog.rescan();
    expect(catalog.get(inside.entry.id)).toMatchObject({ status: 'missing', name: '拍摄笔记' });
  });

  it('检索：索引没跟上时标明不完整；重建期间照样能查到旧的', async () => {
    const second = path.join(projectDir, 'Vlog');
    await fs.mkdir(second);
    await fs.writeFile(path.join(second, 'video.db'), 'db');
    reader.videos.set(second, videoContent('v2', 'r1', { text: '周末去爬山' }));
    reader.failing.add(second);
    const { catalog, index } = await open();
    let result = searchContent(catalog, USER_VIEWER, { query: '剪辑' });
    expect(result).toMatchObject({ complete: false, pendingVideos: 1, truncated: false });
    expect(result.hits).toEqual([
      expect.objectContaining({
        videoId: 'v1',
        videoName: '视频 v1',
        entryId: byName(catalog, '访谈').id,
        documentKind: 'caption',
        time: { clock: 'source', start: 2, end: 3 },
        snippet: '今天讲剪辑',
        highlights: [[3, 5]],
        indexedRevision: 'rev-1',
      }),
    ]);

    reader.failing.delete(second);
    index.touched(second, 'r1');
    await catalog.idle();
    result = searchContent(catalog, USER_VIEWER, { query: '爬山' });
    expect(result).toMatchObject({ complete: true, pendingVideos: 0, hits: [{ videoId: 'v2' }] });
    expect(searchContent(catalog, USER_VIEWER, { query: '', speaker: '宝玉', videoIds: ['v1'] }).hits.map((h) => h.videoId)).toEqual([
      'v1',
    ]);

    // 视频提交了新版本：重读完之前旧的照样能查到，但结果不完整。
    reader.failing.add(videoDir);
    index.touched(videoDir, 'rev-2');
    await catalog.idle();
    result = searchContent(catalog, USER_VIEWER, { query: '剪辑' });
    expect(result).toMatchObject({ complete: false, pendingVideos: 1, hits: [{ indexedRevision: 'rev-1' }] });

    // 重建：全部重读，重读完之前不完整。
    reader.failing.delete(videoDir);
    const reads = reader.reads;
    let release!: () => void;
    reader.hold = new Promise((resolve) => (release = resolve));
    const rebuilt = await catalog.rebuild();
    expect(rebuilt.pendingVideos).toBe(2);
    expect(searchContent(catalog, USER_VIEWER, { query: '爬山' })).toMatchObject({
      complete: false,
      pendingVideos: 2,
      hits: [{ videoId: 'v2' }],
    });
    release();
    await catalog.idle();
    expect(reader.reads).toBe(reads + 2);
    expect(searchContent(catalog, USER_VIEWER, { query: '剪辑' })).toMatchObject({ complete: true });
    expect(storedVideos(path.join(tmp, 'cache', 'content-index'))).toBe(2);
  });

  it('按主体过滤：会话的来源目录、对外服务的视频范围与自己的任务', async () => {
    await seedJobs();
    const second = path.join(otherDir, '别的视频');
    await fs.mkdir(second);
    await fs.writeFile(path.join(second, 'video.db'), 'db');
    reader.videos.set(second, videoContent('v9', 'r1', { text: '剪辑别的' }));
    const conversation = { id: 'c9', projectId: null, cwd: otherDir } as never;
    directory = new TopicLog<DirectorySnapshot, DirectoryEvent>(() => ({ projects: [project], conversations: [conversation] }), '0');
    const mine = job({
      kind: 'generateImage',
      state: 'completed',
      videoId: 'v1',
      submitter: { kind: 'service', id: 'mcp', clientId: 'me' },
      result: { documentId: null, artifactId: 'sha256:mine', outputs: [imageOutput('sha256:mine', null)] },
    });
    jobs.put(mine);
    const { catalog } = await open();

    const agent: SpaceViewer = { kind: 'source', projectId: null, conversationId: 'c9' };
    expect(listEntries(catalog, agent, {}).entries.map((e) => e.fileName)).toEqual(['别的视频']);
    expect(searchContent(catalog, agent, { query: '剪辑' }).hits.map((h) => h.videoId)).toEqual(['v9']);
    expect(() => visibleEntry(catalog, agent, 'sha256:aa')).toThrow(RpcError);

    const service = (videos: 'all' | Set<string>): SpaceViewer => ({
      kind: 'service',
      videos,
      owns: (r) => r.submitter.kind === 'service' && r.submitter.clientId === 'me',
      jobs: (id) => jobs.records.find((r) => r.jobId === id) ?? null,
    });
    // 范围是 v1：视频本身与自己提交的任务的产物；别人的产物与导出、项目里的普通文件不可见。
    const scoped = listEntries(catalog, service(new Set(['v1'])), { trash: 'include' }).entries;
    expect(scoped.map((e) => e.fileName)).toEqual(expect.arrayContaining([expect.stringMatching(/^生成图片-/), '访谈']));
    expect(scoped).toHaveLength(2);
    expect(scoped.find((e) => e.id === 'sha256:mine')).toBeTruthy();
    expect(listEntries(catalog, service(new Set(['v1'])), {}).issues).toEqual([]);
    // 不属于项目的视频（会话目录里的）对外服务不可见；名单之外的视频不出现在命中里，也不算进待索引。
    const outOfScope = searchContent(catalog, service(new Set(['v1'])), { query: '剪辑' });
    expect(outOfScope.hits.map((h) => h.videoId)).toEqual(['v1']);
    expect(searchContent(catalog, service(new Set(['v2'])), { query: '剪辑' })).toMatchObject({ hits: [], pendingVideos: 0 });
    expect(searchContent(catalog, service('all'), { query: '剪辑' }).hits.map((h) => h.videoId)).toEqual(['v1']);
  });
  it('库的格式版本不对时删库重建：重读完之前算没有索引，之后有文稿的事实；早先的 JSON 缓存删掉', async () => {
    reader.videos.set(videoDir, speechContent('v1', 'rev-1'));
    const opened = await open();
    const indexDir = path.join(tmp, 'cache', 'content-index');
    await opened.catalog.close();
    // 修改时间与版本都没变：库的格式版本不对时不重读就补不上。
    const raw = new DatabaseSync(path.join(indexDir, 'index.db'));
    raw.exec('PRAGMA user_version = 999');
    raw.close();
    const legacy = path.join(indexDir, '0123456789abcdef0123456789abcdef.json');
    await fs.writeFile(legacy, JSON.stringify({ schemaVersion: 4, dir: videoDir, segments: [] }));

    const reads = reader.reads;
    let release!: () => void;
    reader.hold = new Promise((resolve) => (release = resolve));
    const index = new ContentIndex({ dir: indexDir, reader, log: silentLogger });
    await index.load();
    expect(index.at(videoDir)).toBeNull();
    await expect(fs.stat(legacy)).rejects.toThrow();
    const catalog = new SpaceCatalog({ harness: harness(), marks, log: silentLogger, watch: false, jobs, index });
    catalogs.push(catalog);
    catalog.start();
    await catalog.ready;
    const dub = toolDefinition('dub')!;
    // 重读之前：还不知道 videoId，不能断定没有文稿，照样列出、标没有索引。
    expect(toolCandidates(catalog, USER_VIEWER, dub, {})).toMatchObject({
      complete: false,
      pendingVideos: 1,
      candidates: [{ videoId: null, indexed: false, documents: [] }],
    });
    expect(searchContent(catalog, USER_VIEWER, { query: '剪辑' })).toMatchObject({ complete: false, hits: [] });
    release();
    await catalog.idle();
    expect(reader.reads).toBe(reads + 1);
    expect(index.at(videoDir)).toMatchObject({ facts: { transcripts: [{ documentId: 'speech-v1', language: 'zh' }] } });
    expect(toolCandidates(catalog, USER_VIEWER, dub, {})).toMatchObject({
      complete: true,
      candidates: [{ videoId: 'v1', indexed: true, documents: [{ documentId: 'speech-v1' }] }],
    });
    expect(storedVideos(indexDir)).toBe(1);
  });

  it('视频条目的 media 是根序列的时长与画布尺寸；快照不全时没有；删库之后重读补上', async () => {
    const { catalog, index } = await open();
    expect(byName(catalog, '访谈')).toMatchObject({ kind: 'video', ref: { videoId: 'v1' } });
    expect(byName(catalog, '访谈').media).toBeUndefined();

    reader.videos.set(
      videoDir,
      videoContent('v1', 'rev-2', { used: ['asset-applied'], timeline: { width: 1920, height: 1080, frames: 450 } }),
    );
    index.touched(videoDir, 'rev-2');
    await catalog.idle();
    expect(byName(catalog, '访谈').media).toEqual({ durationSec: 15, width: 1920, height: 1080 });
    await catalog.close();

    // 关着的时候没变：重开不重读，事实从库里读回。
    const indexDir = path.join(tmp, 'cache', 'content-index');
    let reads = reader.reads;
    const { catalog: same } = await open(indexDir);
    expect(reader.reads).toBe(reads);
    expect(byName(same, '访谈').media).toEqual({ durationSec: 15, width: 1920, height: 1080 });
    await same.close();

    // 库整个删掉（它是缓存）：重开时全部重读。
    for (const name of await fs.readdir(indexDir)) await fs.rm(path.join(indexDir, name));
    reads = reader.reads;
    const { catalog: reopened, index: reloaded } = await open(indexDir);
    expect(reader.reads).toBe(reads + 1);
    expect(reloaded.at(videoDir)).toMatchObject({ revision: 'rev-2', facts: { timeline: { durationSec: 15 } } });
    expect(byName(reopened, '访谈').media).toEqual({ durationSec: 15, width: 1920, height: 1080 });
  });

  it('ensure：还没有索引的视频排到队首先读，读完就返回；不在目录里的、超时的回答手上有的', async () => {
    const dirs = ['甲', '乙', '丙'].map((name) => path.join(projectDir, name));
    for (const [i, dir] of dirs.entries()) {
      await fs.mkdir(dir, { recursive: true });
      reader.videos.set(dir, videoContent(`v${i}`, 'rev-1'));
    }
    const order: string[] = [];
    const read = reader.readContent.bind(reader);
    reader.readContent = async (dir: string) => {
      order.push(path.basename(dir));
      return read(dir);
    };
    let release!: () => void;
    reader.hold = new Promise((resolve) => (release = resolve));
    const index = new ContentIndex({ dir: path.join(tmp, 'cache', 'ensure'), reader, log: silentLogger });
    await index.sync(dirs.map((dir) => ({ dir, mtimeMs: 1 })));
    // 甲正在读（被挡住）：等乙超时，回答手上有的（还没有）；之后丙插到乙前面。
    expect(await index.ensure(dirs[1]!, 10)).toBeNull();
    expect(await index.ensure(path.join(projectDir, '不在目录里'))).toBeNull();
    const third = index.ensure(dirs[2]!);
    release();
    expect(await third).toMatchObject({ videoId: 'v2', facts: { poster: null } });
    await index.idle();
    expect(order).toEqual(['甲', '丙', '乙']);
    // 已经有当前索引的不等。
    reader.hold = new Promise(() => {});
    expect(await index.ensure(dirs[0]!, 10_000)).toMatchObject({ videoId: 'v0' });
    await index.close();
  });

  it('工具的候选输入：按工具的规则筛视频，带文稿与已有的译文；没有索引的照样列出；分页、项目、回收站与主体', async () => {
    reader.videos.set(videoDir, speechContent('v1', 'rev-1', 'en'));
    const plain = path.join(projectDir, '没有转写');
    const broken = path.join(projectDir, '读不了');
    for (const dir of [plain, broken]) {
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'video.db'), 'db');
    }
    reader.videos.set(plain, videoContent('v2', 'r1'));
    reader.videos.set(broken, videoContent('v3', 'r1'));
    reader.failing.add(broken);
    const { catalog } = await open();
    const transcribe = toolDefinition('transcribe')!;
    const dub = toolDefinition('dub')!;
    const names = (result: { candidates: { name: string }[] }) => result.candidates.map((c) => c.name).sort();

    const all = toolCandidates(catalog, USER_VIEWER, transcribe, {});
    expect(names(all)).toEqual(['没有转写', '访谈', '读不了']);
    expect(all).toMatchObject({ toolId: 'transcribe', total: 3, complete: false, pendingVideos: 1, nextCursor: null });
    expect(all.candidates.find((c) => c.name === '读不了')).toMatchObject({ indexed: false, documents: [] });
    // 转写不需要文稿：不列文档。
    expect(all.candidates.find((c) => c.name === '访谈')).toMatchObject({
      videoId: 'v1',
      indexed: true,
      indexedRevision: 'rev-1',
      documents: [],
    });

    // 翻译配音只列有文稿的视频（读不了的不能断定，照样列出）；文稿带语言、逐词时间与已有的译文。
    const dubbing = toolCandidates(catalog, USER_VIEWER, dub, {});
    expect(names(dubbing)).toEqual(['访谈', '读不了']);
    expect(dubbing.candidates.find((c) => c.name === '访谈')!.documents).toEqual([
      {
        kind: 'speech',
        documentId: 'speech-v1',
        name: '转写',
        language: 'zh',
        wordTiming: true,
        onTimeline: false,
        translations: [{ documentId: 'tr-v1', language: 'en', units: 1, staleUnits: 1 }],
        dubs: [],
      },
    ]);

    // 分页与项目。
    const first = toolCandidates(catalog, USER_VIEWER, transcribe, { limit: 2 });
    expect(first).toMatchObject({ total: 3, nextCursor: '2' });
    expect(toolCandidates(catalog, USER_VIEWER, transcribe, { limit: 2, cursor: '2' }).candidates).toHaveLength(1);
    expect(toolCandidates(catalog, USER_VIEWER, transcribe, { projectId: 'nope' })).toMatchObject({ total: 0, candidates: [] });
    expect(toolCandidates(catalog, USER_VIEWER, transcribe, { projectId: 'p1' }).total).toBe(3);

    // 主体：会话只看到自己的来源目录；对外服务按视频名单，名单之外、不知道 videoId 的不列。
    const agent: SpaceViewer = { kind: 'source', projectId: null, conversationId: 'c9' };
    expect(toolCandidates(catalog, agent, transcribe, {}).total).toBe(0);
    const service: SpaceViewer = { kind: 'service', videos: new Set(['v2']), owns: () => false, jobs: () => null };
    expect(names(toolCandidates(catalog, service, transcribe, {}))).toEqual(['没有转写']);
    expect(toolCandidates(catalog, service, transcribe, {})).toMatchObject({ pendingVideos: 0 });

    // 回收站里的视频不列。
    await trashVideo(catalog);
    await catalog.idle();
    expect(names(toolCandidates(catalog, USER_VIEWER, transcribe, {}))).toEqual(['没有转写', '读不了']);
  });
  /** 照 `VideoTrash` 的顺序删除一个视频：先记下，再把目录移进回收站，再重扫来源。 */
  async function trashVideo(catalog: SpaceCatalog, trashedAt = new Date().toISOString()) {
    const info = (await catalog.videoEntryAt(videoDir))!;
    const trashRelPath = `.bcut-trash/t1/${path.basename(videoDir)}`;
    const entryId = catalog.trashEntryId(info.sourceKey, trashRelPath);
    await catalog.recordTrashedVideo(entryId, {
      formerEntryId: info.entry.id,
      sourceKey: info.sourceKey,
      projectId: 'p1',
      conversationId: null,
      relPath: info.relPath,
      trashRelPath,
      videoId: 'v1',
      name: info.entry.name,
      size: info.entry.size,
      trashedAt,
    });
    const to = path.join(projectDir, ...trashRelPath.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(videoDir, to);
    await catalog.refreshSource(info.sourceKey);
    return { entryId, formerId: info.entry.id, to };
  }

  const detailCode = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (error) {
      return ((error as RpcError).details as { code?: string } | undefined)?.code;
    }
    throw new Error('应该拒绝');
  };

  it('删除了的视频：回收站里的条目、旧 id 能找到；物理删除查引用，只删归视频管理的文件，链接素材的原文件不动', async () => {
    const { catalog } = await open();
    const former = byName(catalog, '访谈');
    await catalog.update({ entryId: former.id, favorite: true });
    await fs.mkdir(path.join(videoDir, 'blobs'));
    await fs.writeFile(path.join(videoDir, 'blobs', 'b1'), 'blob');
    await fs.writeFile(path.join(videoDir, 'video.db-wal'), 'wal');
    await fs.writeFile(path.join(videoDir, '笔记.txt'), '用户放进来的');

    // 直接改标记不能把视频移进回收站（方法层转给 videos.delete）。
    expect(await detailCode(() => catalog.update({ entryId: former.id, trashed: true }))).toBe('SPACE_TRASH_VIDEO');

    const { entryId, formerId, to } = await trashVideo(catalog);
    expect(entryId).not.toBe(formerId);
    expect(catalog.get(entryId)).toMatchObject({
      kind: 'video',
      name: former.name,
      relPath: '访谈',
      source: { projectId: 'p1' },
      ref: { videoId: 'v1' },
      user: { favorite: true },
    });
    expect(catalog.get(entryId).user.trashedAt).not.toBeNull();
    expect(() => catalog.get(formerId)).toThrow(RpcError);
    // 回收站目录不被当成来源目录里的视频扫进来。
    expect(catalog.videos()).toEqual([]);
    expect(listEntries(catalog, USER_VIEWER, { kind: 'video' }).entries).toEqual([]);
    expect(listEntries(catalog, USER_VIEWER, { trash: 'only' }).entries.map((e) => e.id)).toEqual([entryId]);
    expect(catalog.trashedVideo(formerId)?.entryId).toBe(entryId);
    expect(catalog.trashedVideo(entryId)?.record.trashRelPath).toBe('.bcut-trash/t1/访谈');
    expect(await detailCode(() => catalog.openForEdit(entryId))).toBe('VIDEO_TRASHED');
    expect(await detailCode(() => catalog.locate(entryId))).toBe('VIDEO_TRASHED');
    expect(await detailCode(() => catalog.update({ entryId, trashed: false }))).toBe('SPACE_TRASH_VIDEO');

    // 目录里有不归视频管理的文件：不删，列出来。
    expect(await catalog.purge(entryId)).toEqual({
      status: 'blocked',
      entryId,
      references: [expect.objectContaining({ kind: 'user-file', detail: expect.stringContaining('笔记.txt') })],
    });
    await fs.rm(path.join(to, '笔记.txt'));

    // 结果还等用户决定写不写进这个视频的任务、进行中的任务：不删。
    const pending = job({ kind: 'generateImage', state: 'needs-reconciliation', videoId: 'v1' });
    jobs.put(pending);
    expect(await catalog.purge(entryId)).toMatchObject({ status: 'blocked', references: [{ kind: 'job', jobId: pending.jobId }] });
    jobs.put({ ...pending, state: 'cancelled' });

    expect(await catalog.purge(entryId)).toEqual({ status: 'purged', entryId });
    await expect(fs.stat(to)).rejects.toThrow();
    await expect(fs.stat(path.join(projectDir, '.bcut-trash'))).rejects.toThrow();
    // 链接素材的原文件在视频目录之外，不动。
    await expect(fs.readFile(path.join(projectDir, 'raw', 'clip.mp4'), 'utf8')).resolves.toBe('mp4');
    expect(() => catalog.get(entryId)).toThrow(RpcError);
    expect(marks.trashedVideos().size).toBe(0);
  });

  it('删除了的视频：启动时按目录实际在哪里核对记录；回收站保留期到了才物理删除，有引用的留着', async () => {
    const first = await open();
    const info = (await first.catalog.videoEntryAt(videoDir))!;
    // 记下了、目录没有移过去（删除时崩溃）：重启后记录去掉，视频还在原处，标记回到原来的条目。
    await first.catalog.update({ entryId: info.entry.id, favorite: true });
    await first.catalog.recordTrashedVideo(first.catalog.trashEntryId(info.sourceKey, '.bcut-trash/t0/访谈'), {
      formerEntryId: info.entry.id,
      sourceKey: info.sourceKey,
      projectId: 'p1',
      conversationId: null,
      relPath: info.relPath,
      trashRelPath: '.bcut-trash/t0/访谈',
      videoId: 'v1',
      name: info.entry.name,
      size: info.entry.size,
      trashedAt: new Date().toISOString(),
    });
    await first.catalog.close();
    const second = await open();
    expect(marks.trashedVideos().size).toBe(0);
    expect(second.catalog.get(info.entry.id)).toMatchObject({ kind: 'video', user: { favorite: true, trashedAt: null } });

    // 真的移进去了：重启后还在回收站里。
    const now = Date.now();
    const { entryId } = await trashVideo(second.catalog, new Date(now - 31 * 86_400_000).toISOString());
    const cover = byName(second.catalog, 'cover.png');
    await second.catalog.update({ entryId: cover.id, trashed: true });
    const clip = byName(second.catalog, 'clip.mp4');
    await second.catalog.update({ entryId: clip.id, trashed: true });
    await second.catalog.close();
    const { catalog } = await open();
    expect(catalog.get(entryId).user.trashedAt).not.toBeNull();

    // 保留期 30 天：刚移进来的不删；删除了 31 天的视频删掉。
    expect(await catalog.sweepTrash(30, now)).toEqual({ purged: 1, kept: 0 });
    expect(() => catalog.get(entryId)).toThrow(RpcError);
    // 到期之后：没有引用的删掉。
    expect(await catalog.sweepTrash(30, now + 31 * 86_400_000)).toEqual({ purged: 2, kept: 0 });
    await expect(fs.stat(path.join(projectDir, 'cover.png'))).rejects.toThrow();
    await expect(fs.stat(path.join(projectDir, 'raw', 'clip.mp4'))).rejects.toThrow();
  });

  it('回收站保留期：仍被视频链接着的文件到期也留着', async () => {
    const { catalog } = await open();
    const clip = byName(catalog, 'clip.mp4');
    await catalog.update({ entryId: clip.id, trashed: true });
    expect(await catalog.sweepTrash(30, Date.now() + 31 * 86_400_000)).toEqual({ purged: 0, kept: 1 });
    await expect(fs.readFile(path.join(projectDir, 'raw', 'clip.mp4'), 'utf8')).resolves.toBe('mp4');
    expect(catalog.get(clip.id).user.trashedAt).not.toBeNull();
  });

  it('配音流程的内部产物：只留引用、不进目录；Ledger 修剪之后仍被引用，产物库清扫不删', async () => {
    const audio = artifactIdOf(Buffer.from('dub audio'));
    const plan = `sha256:${'e'.repeat(64)}`;
    const dub = job({
      kind: 'pipeline',
      state: 'completed',
      videoId: 'v1',
      inputHash: `sha256:${'f'.repeat(64)}`,
      pipeline: {
        name: 'dub',
        label: '配音',
        stoppedAt: null,
        summary: null,
        steps: [
          { name: 'synthesize', label: '合成', status: 'completed', jobId: 'job_synth', attempts: 1, output: { artifactId: plan, units: { u1: { artifactId: audio } } } },
        ],
      } as unknown as JobRecord['pipeline'],
    });
    jobs.put(dub);
    const file = path.join(tmp, 'store', 'space-artifacts.json');
    const artifacts = new SpaceArtifactStore(file);
    await artifacts.load();
    const baseline = (await open()).catalog.entries().length;
    const first = await open(undefined, artifacts);
    // 不派生新的目录条目，也不留派生用的事实。
    expect(first.catalog.entries()).toHaveLength(baseline);
    expect(first.catalog.entries().some((e) => e.id === audio || e.id === plan)).toBe(false);
    expect(artifacts.list()).toEqual([]);
    expect(artifacts.references()).toEqual([{ jobId: dub.jobId, kind: 'pipeline', videoId: 'v1', endedAt: dub.endedAt, artifactIds: [audio, plan].sort() }]);
    await first.catalog.close();
    await artifacts.flush();

    // Ledger 修剪掉了这次配音：重启之后引用照样在，产物库清扫不删它的音频。
    jobs.records = [];
    const reloaded = new SpaceArtifactStore(file);
    await reloaded.load();
    const refs = await reloaded.referencedArtifactIds();
    expect(refs.has(audio) && refs.has(plan)).toBe(true);
    expect(refs.has(dub.inputHash)).toBe(false);
    const store = new ArtifactStore(path.join(tmp, 'artifacts'));
    const kept = await store.put(Buffer.from('dub audio'), 'wav');
    const orphan = await store.put(Buffer.from('orphan'), 'wav');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const f of [kept.path, orphan.path]) await fs.utimes(f, old, old);
    expect(kept.artifactId).toBe(audio);
    const result = await store.sweep(refs);
    expect(result).toMatchObject({ removed: 1 });
    await expect(fs.stat(kept.path)).resolves.toBeTruthy();
    await expect(fs.stat(orphan.path)).rejects.toThrow();
  });

  it('流程新建的视频：Job Ledger 修剪掉这次运行之后，视频条目的来源照样在', async () => {
    const created = job({
      kind: 'pipeline',
      state: 'completed',
      videoId: 'v1',
      pipeline: {
        name: 'transcribe',
        label: '转录',
        stoppedAt: null,
        summary: null,
        steps: [
          { name: 'target', label: '解析目标', status: 'skipped', jobId: null, attempts: 0, output: null },
          { name: 'create', label: '新建视频', status: 'completed', jobId: 'job_step', attempts: 1, output: { videoId: 'v1', place: {} } },
        ],
      } as unknown as JobRecord['pipeline'],
    });
    jobs.put(created);
    const file = path.join(tmp, 'store', 'space-artifacts.json');
    const artifacts = new SpaceArtifactStore(file);
    await artifacts.load();
    const first = await open(undefined, artifacts);
    const origin = { source: 'imported', projectId: 'p1', videoId: 'v1', jobId: created.jobId, capability: 'transcribe' };
    expect(byName(first.catalog, '访谈')).toMatchObject({ kind: 'video', origin });
    await first.catalog.close();

    // Ledger 修剪掉了这次运行：重启之后来源照样在（记录没有产物，也不会被当成清除完了去掉）。
    jobs.records = [];
    const reloaded = new SpaceArtifactStore(file);
    await reloaded.load();
    const { catalog } = await open(undefined, reloaded);
    expect(byName(catalog, '访谈')).toMatchObject({ kind: 'video', origin });
    await catalog.purge('sha256:none').catch(() => {});
    expect(reloaded.list().map((f) => f.jobId)).toEqual([created.jobId]);
  });

  it('产物记录：Job Ledger 修剪掉任务之后产物条目还在；产物都物理删除之后记录去掉', async () => {
    await seedJobs();
    const file = path.join(tmp, 'store', 'space-artifacts.json');
    const artifacts = new SpaceArtifactStore(file);
    await artifacts.load();
    const first = await open(undefined, artifacts);
    const before = first.catalog.get('sha256:aa');
    expect(before).toMatchObject({ status: 'applied', origin: { source: 'generated', videoId: 'v1' } });
    await first.catalog.close();
    // 记录里只有派生用的事实，没有 Ledger 的其余内容。
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as { jobs: Record<string, unknown>[] };
    expect(saved.jobs.map((j) => j.kind).sort()).toEqual(['export', 'generateImage']);
    expect(saved.jobs.every((j) => !('warnings' in j) && !('contentHash' in j))).toBe(true);

    // Ledger 修剪掉了全部任务（不发事件）：重启之后产物与导出照样在，占位不在。
    jobs.records = [];
    const reloaded = new SpaceArtifactStore(file);
    await reloaded.load();
    const { catalog } = await open(undefined, reloaded);
    expect(catalog.get('sha256:aa')).toEqual(before);
    expect(catalog.get('sha256:bb')).toMatchObject({ status: 'candidate' });
    expect(byName(catalog, '访谈.srt')).toMatchObject({ kind: 'subtitle', status: 'published', ref: { artifactId: 'sha256:srt' } });
    expect(catalog.entries().some((e) => e.status === 'generating' || e.status === 'failed')).toBe(false);

    // 一个任务的产物删掉一部分，记录留着；全部删掉之后去掉，清除标记也不再需要。
    for (const id of ['sha256:bb', 'sha256:aa']) {
      await catalog.update({ entryId: id, trashed: true });
      expect(await catalog.purge(id)).toMatchObject({ status: 'purged' });
      expect(reloaded.list().some((f) => f.kind === 'generateImage')).toBe(id === 'sha256:bb');
    }
    expect(marks.get('sha256:aa')).toEqual(marks.get('sha256:never'));
    expect(reloaded.list().map((f) => f.kind)).toEqual(['export']);
  });

  it('文件到文件的流程：发布的字幕文件合进扫描到的文件或单独成条，来源是生成、带流程名与执行者；Ledger 修剪之后照样在', async () => {
    const inside = path.join(projectDir, 'raw', 'clip.zh-CN.srt');
    const outside = path.join(otherDir, 'talk.zh-CN.vtt');
    await fs.writeFile(inside, '1\n00:00:01,000 --> 00:00:02,000\n你好\n');
    await fs.writeFile(outside, 'WEBVTT\n');
    const output = (artifactId: string, file: string, format: 'srt' | 'vtt') => ({
      artifactId,
      mediaType: format === 'srt' ? 'application/x-subrip' : 'text/vtt',
      byteLength: 10,
      assetId: null,
      media: { kind: 'text' as const, entries: 1, durationSec: 2 },
      path: file,
      format,
    });
    const translated = (artifactId: string, file: string, format: 'srt' | 'vtt') =>
      job({
        kind: 'pipeline',
        state: 'completed',
        providerId: 'openai',
        modelId: 'gpt',
        pipeline: { name: 'translate-subtitles', steps: [] } as never,
        result: { documentId: null, artifactId, outputs: [output(artifactId, file, format)] },
      });
    jobs.put(translated('sha256:in', inside, 'srt'));
    jobs.put(translated('sha256:out', outside, 'vtt'));
    // 下载也是文件产物；项目归属与文件的物理目录独立。
    jobs.put(
      job({
        kind: 'pipeline',
        state: 'completed',
        pipeline: { name: 'link-import', params: { projectId: 'assigned-project' }, steps: [] } as never,
        result: { documentId: null, artifactId: 'sha256:dl', outputs: [output('sha256:dl', path.join(projectDir, 'cover.png'), 'srt')] },
      }),
    );
    const file = path.join(tmp, 'store', 'space-artifacts.json');
    const artifacts = new SpaceArtifactStore(file);
    await artifacts.load();
    const first = await open(undefined, artifacts);
    const origin = { source: 'generated', capability: 'translate-subtitles', provider: { providerId: 'openai', modelId: 'gpt' } };
    expect(byName(first.catalog, 'clip.zh-CN.srt')).toMatchObject({
      kind: 'subtitle',
      relPath: 'raw/clip.zh-CN.srt',
      status: 'published',
      ref: { artifactId: 'sha256:in' },
      origin,
      media: { mediaType: 'application/x-subrip', durationSec: 2 },
    });
    const standalone = first.catalog.get('sha256:out');
    expect(standalone).toMatchObject({ kind: 'subtitle', fileName: 'talk.zh-CN.vtt', status: 'published', origin });
    expect(byName(first.catalog, 'cover.png').origin).toMatchObject({ capability: 'link-import', projectId: 'assigned-project' });
    expect(projectOf(byName(first.catalog, 'cover.png'))).toBe('assigned-project');
    await first.catalog.close();

    // 产物记录只留流程名；Ledger 修剪掉之后重启，条目照样在。
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as { jobs: Array<{ kind: string; pipeline?: unknown }> };
    expect(saved.jobs.map((j) => j.pipeline)).toEqual(expect.arrayContaining([{ name: 'translate-subtitles' }, { name: 'link-import', params: { projectId: 'assigned-project' } }]));
    expect(saved.jobs).toHaveLength(3);
    jobs.records = [];
    const reloaded = new SpaceArtifactStore(file);
    await reloaded.load();
    const { catalog } = await open(undefined, reloaded);
    expect(catalog.get('sha256:out')).toEqual(standalone);
    expect(projectOf(byName(catalog, 'cover.png'))).toBe('assigned-project');
    expect(byName(catalog, 'clip.zh-CN.srt')).toMatchObject({ ref: { artifactId: 'sha256:in' }, origin });
  });
  it('工具的 Space 条目输入：换成文件路径或文字；回收站、种类不合、没有文件在提交时拒绝；保存位置里的结果带 file', async () => {
    const subtitle = path.join(projectDir, 'raw', 'talk.srt');
    await fs.writeFile(subtitle, '1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nworld\n');
    await fs.writeFile(path.join(projectDir, 'notes.md'), '# 标题\n正文\n');
    await fs.writeFile(path.join(projectDir, 'brief.pdf'), '%PDF');
    // 只给文件的转录写到保存位置（来源目录之外）；语音合成另存了副本。
    const saved = path.join(otherDir, 'clip.txt');
    await fs.writeFile(saved, 'Hello\n');
    const audioCopy = path.join(otherDir, 'Hello.mp3');
    await fs.writeFile(audioCopy, 'mp3');
    const art = path.join(tmp, 'artifacts');
    await fs.mkdir(art, { recursive: true });
    jobs.files.set('sha256:mp3', path.join(art, 'mp3.mp3'));
    await fs.writeFile(path.join(art, 'mp3.mp3'), 'mp3');
    const text = (artifactId: string, file: string) => ({
      artifactId,
      mediaType: 'text/plain',
      byteLength: 6,
      assetId: null,
      media: { kind: 'text' as const, entries: 1, durationSec: 1 },
      path: file,
    });
    jobs.put(
      job({
        kind: 'pipeline',
        state: 'completed',
        pipeline: { name: 'transcribe', steps: [] } as never,
        result: { documentId: null, artifactId: 'sha256:txt', outputs: [text('sha256:txt', saved), text('sha256:gone', path.join(otherDir, 'gone.srt'))] },
      }),
    );
    jobs.put(
      job({
        kind: 'synthesizeSpeech',
        state: 'completed',
        result: {
          documentId: null,
          artifactId: 'sha256:mp3',
          outputs: [
            { artifactId: 'sha256:mp3', mediaType: 'audio/mpeg', byteLength: 3, assetId: null, media: { kind: 'audio', durationSec: 1, sampleRate: 48000, channels: 1 }, path: audioCopy },
          ],
        },
      }),
    );
    const { catalog } = await open();
    const transcript = catalog.get('sha256:txt');
    expect(transcript).toMatchObject({ kind: 'document', file: { path: saved }, origin: { capability: 'transcribe' } });
    expect(catalog.get('sha256:gone')).toMatchObject({ status: 'missing' });
    expect(catalog.get('sha256:gone').file).toBeUndefined();
    expect(catalog.get('sha256:mp3')).toMatchObject({ kind: 'audio', file: { path: audioCopy } });

    const srt = byName(catalog, 'talk.srt');
    const clip = byName(catalog, 'clip.mp4');
    expect(catalog.resolveFile(srt.id, ['subtitle']).file).toBe(subtitle);
    expect(catalog.resolveFile('sha256:mp3', ['audio']).file).toBe(path.join(art, 'mp3.mp3'));
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return [(error as { code: string }).code, (error as { details?: { code?: string } }).details?.code];
      }
      return null;
    };
    expect(code(() => catalog.resolveFile('nope', ['subtitle']))).toEqual(['not-found', undefined]);
    expect(code(() => catalog.resolveFile(byName(catalog, '访谈').id, ['video-file']))).toEqual(['invalid-request', 'SPACE_ENTRY_UNSUPPORTED']);
    expect(code(() => catalog.resolveFile(clip.id, ['subtitle']))).toEqual(['invalid-request', 'SPACE_ENTRY_UNSUPPORTED']);
    expect(code(() => catalog.resolveFile('sha256:gone', ['document', 'subtitle']))).toEqual(['conflict', 'SPACE_ENTRY_NO_FILE']);

    // 流程参数：只换 `{ entryId }`，路径与别的字段原样。
    expect(resolvePipelineEntryInputs(catalog, 'transcribe', { file: { entryId: clip.id }, language: 'en' })).toEqual({
      file: path.join(projectDir, 'raw', 'clip.mp4'),
      language: 'en',
    });
    expect(resolvePipelineEntryInputs(catalog, 'transcode', { action: 'compress', inputs: ['/a.mp4', { entryId: clip.id }] })).toEqual({
      action: 'compress',
      inputs: ['/a.mp4', path.join(projectDir, 'raw', 'clip.mp4')],
    });
    expect(resolvePipelineEntryInputs(catalog, 'translate-subtitles', { input: { entryId: srt.id }, targetLanguage: 'zh' })).toEqual({
      input: subtitle,
      targetLanguage: 'zh',
    });
    expect(code(() => resolvePipelineEntryInputs(catalog, 'translate-subtitles', { input: { entryId: clip.id } }))).toEqual([
      'invalid-request',
      'SPACE_ENTRY_UNSUPPORTED',
    ]);
    const untouched = { videoId: 'v1', target: { entryId: 'x' } };
    expect(resolvePipelineEntryInputs(catalog, 'translate', untouched)).toBe(untouched);

    // 素材：字幕去掉时间码与标记，文档原样；PDF 不是文字。
    expect(await materialText(catalog, srt.id)).toEqual({ text: 'Hello\nworld', fileName: 'talk.srt' });
    expect((await materialText(catalog, byName(catalog, 'notes.md').id)).text).toBe('# 标题\n正文\n');
    await expect(materialText(catalog, byName(catalog, 'brief.pdf').id)).rejects.toMatchObject({
      details: { code: 'SPACE_ENTRY_UNSUPPORTED' },
    });
    await expect(materialText(catalog, clip.id)).rejects.toMatchObject({ details: { code: 'SPACE_ENTRY_UNSUPPORTED' } });
    expect(await withSpeechMaterial(catalog, { text: '', material: { entryId: srt.id }, voice: 'alloy' })).toEqual({
      text: 'Hello\nworld',
      voice: 'alloy',
    });
    expect(await withSpeechMaterial(catalog, { text: '你好' })).toEqual({ text: '你好' });
    expect(
      await withTextMaterial(catalog, {
        messages: [
          { role: 'system', content: '简洁' },
          { role: 'user', content: '总结一下 ' },
        ],
        material: { entryId: srt.id },
      }),
    ).toEqual({
      messages: [
        { role: 'system', content: '简洁' },
        { role: 'user', content: '总结一下\n\ntalk.srt\n\nHello\nworld' },
      ],
    });

    // 回收站里的条目。
    await catalog.update({ entryId: srt.id, trashed: true });
    expect(code(() => catalog.resolveFile(srt.id, ['subtitle']))).toEqual(['conflict', 'SPACE_ENTRY_TRASHED']);
  });
});
