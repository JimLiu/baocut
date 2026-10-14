/**
 * 产品级检索评测：走真的 `space.searchV2`（SearchService + 内容索引 + 语义库 + 增量构建 + 融合 + 去重），不只测模型本身。
 * 改排序、融合或弱命中阈值时，在同一个数据集上报改前改后的数字（开发流程 §2）。
 *
 * 数据：
 * - 文字：`fixtures/corpus.json` 的每个句群是一部视频（讲话转写就是这段文字），`fixtures/queries.json` 的查询按类别
 *   （exact-word / paraphrase / cross-lingual / no-answer）出分数；相关 = 命中落在相关句群的那部视频上。
 * - 画面（可选，`--frames <dir>`）：多模态 G0 的 `frames-eval/`（`manifest.json`、`labels.json`、`frames/*.jpg`，取自用户自己的
 *   视频，不进仓库）。每部视频的已标注帧依次排成一个合成素材，第 i 帧在源时间 `i * 8 + 4` 秒（正好是每 8 秒一帧的取帧点）；
 *   相关 = 画面命中的源时间窗口盖住相关帧的时刻。这些合成视频没有讲话转写。
 *
 * 每类查询跑几种请求：文字一路（`hybrid`、`semantic`、`lexical`）、画面一路（`channels: ['visual']`）、两路一起
 * （`channels: ['text', 'visual']`）。输出 R@1、R@5、R@10、MRR（前 20 条），以及弱命中的两面：
 * - `strongPerQuery`：每条查询前 20 条里没标 `weak` 的条数（越少越干净）；
 * - `noAnswerStrong`：没有答案的查询里，至少有一条没标弱的比例（越低越好）；
 * - `relevantWeak`：有答案、前 20 条里找到了答案的查询里，第一条答案被标弱的比例（越低越好）。
 *
 * 编码用本机装好的 EmbeddingGemma 2 模型包（Model Worker 经 LiteRT-LM）：`--models` 是模型目录、`--tools` 是装着
 * `litertlm-runtime` 组件的 Runtime Home `tools/`（都只读：不安装、不自检），Worker 用 `BAOCUT_MODEL_WORKER` 或仓库构建出的
 * `model-worker`。工作目录（`--work`，默认 `$BAOCUT_EMBED_EVAL_ROOT/search-eval`）
 * 里放临时的内容索引、语义库（向量按内容寻址，第二次跑不重编）与 LiteRT 缓存。
 *
 *    node --experimental-strip-types tools/embedding-eval/search-eval.ts --models <dir> --tools <dir> [--frames <dir>] [--work <dir>] [--out <file>] [--label <name>]
 *
 * 结果 JSON 只有汇总数字与运行清单；每条查询的明细写在工作目录（`--details`），不进仓库。
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Id, SpaceSearchV2Hit, SpaceSearchV2Params, VideoSnapshot } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import type { EmbeddingProvider } from '@baocut/models';
import type { SpaceVideo } from '../../packages/runtime-core/src/space-catalog.ts';
import { ContentIndex, type ContentReader } from '../../packages/runtime-core/src/space/content-index.ts';
import type { ReadContentDocument, ReadContentResult } from '../../packages/runtime-core/src/space/content-extract.ts';
import { USER_VIEWER } from '../../packages/runtime-core/src/space/space-queries.ts';
import { openSemanticServices, type SemanticServices } from '../../packages/runtime-core/src/space/semantic/services.ts';
import { RANKING_VERSION } from '../../packages/runtime-core/src/space/semantic/thresholds.ts';
import type { KeyframeSource, VisualAsset } from '../../packages/runtime-core/src/space/semantic/visual-lane.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOT_SEC = 8;
const TOP = 20;

// ---- 数据集 ----

export interface EvalVideo {
  videoId: string;
  /** 讲话转写的文字（没有时这部视频只有画面）。 */
  text: string | null;
  language: string;
  /** 合成素材的帧（按源时间排）：`file` 是图片，第 i 帧在 `i * 8 + 4` 秒。 */
  frames: { id: string; file: string }[];
}

export interface EvalQuery {
  id: string;
  text: string;
  /** `text`：答案是讲话；`visual`：答案是画面。 */
  target: 'text' | 'visual';
  category: string;
  /** 文字查询：相关视频；画面查询：相关帧（`<videoId>#<帧序号>`）。空 = 没有答案。 */
  relevant: string[];
}

export interface EvalDataset {
  videos: EvalVideo[];
  queries: EvalQuery[];
}

export async function textDataset(fixtures = path.join(HERE, 'fixtures')): Promise<EvalDataset> {
  const corpus = JSON.parse(await fs.readFile(path.join(fixtures, 'corpus.json'), 'utf8')) as {
    groups: { id: string; lang: string; text: string }[];
  };
  const queries = JSON.parse(await fs.readFile(path.join(fixtures, 'queries.json'), 'utf8')) as {
    queries: { id: string; category: string; text: string; relevant: string[] }[];
  };
  return {
    videos: corpus.groups.map((g) => ({ videoId: `t-${g.id}`, text: g.text, language: g.lang, frames: [] })),
    queries: queries.queries.map((q) => ({
      id: q.id,
      text: q.text,
      target: 'text',
      category: q.category,
      relevant: q.relevant.map((id) => `t-${id}`),
    })),
  };
}

/** 多模态 G0 的标注帧：每部视频的帧按时间排成一个合成素材。 */
export async function frameDataset(dir: string): Promise<EvalDataset> {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as {
    videos: { id: string }[];
    frames: { id: string; video: string; t: number }[];
  };
  const labels = JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8')) as {
    queries: { id: string; kind: string; text: string; relevant: string[] }[];
  };
  const slotOf = new Map<string, string>();
  const videos: EvalVideo[] = manifest.videos.map((v) => {
    const frames = manifest.frames.filter((f) => f.video === v.id).sort((a, b) => a.t - b.t);
    frames.forEach((f, i) => slotOf.set(f.id, `f-${v.id}#${i}`));
    return {
      videoId: `f-${v.id}`,
      text: null,
      language: 'en',
      frames: frames.map((f) => ({ id: f.id, file: path.join(dir, 'frames', `${f.id}.jpg`) })),
    };
  });
  return {
    videos,
    queries: labels.queries.map((q) => ({
      id: q.id,
      text: q.text,
      target: 'visual',
      category: q.kind === 'none' ? 'no-answer' : q.kind,
      relevant: q.relevant.map((id) => slotOf.get(id)).filter((id): id is string => id !== undefined),
    })),
  };
}

// ---- 假的 Space ----

function speechDoc(video: EvalVideo): ReadContentDocument {
  const text = video.text ?? '';
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, j) => ({ id: `w${j}`, text: w, start: j * 300, end: j * 300 + 300, speaker: 'Host' }));
  return {
    documentId: `d-${video.videoId}`,
    kind: 'speech',
    name: 'Transcript',
    language: video.language,
    revision: '1',
    schema: 'baocut.speech/1',
    sourceAssetId: 'a1',
    sourceDocumentId: null,
    body: { timescale: 1000, words, sentences: null },
    plan:
      words.length > 0
        ? {
            sequenceId: 'seq',
            documentId: `d-${video.videoId}`,
            unit: 'speech' as const,
            clock: 'sequence' as const,
            scope: { basis: 'root', captionItemIds: [], scopeItemIds: [] },
            range: { startSeconds: 0, endSeconds: 1000, durationSeconds: 1000 },
            entries: words.map((w) => ({
              key: w.id,
              id: w.id,
              start: w.start / 1000,
              end: w.end / 1000,
              text: w.text,
              speaker: w.speaker,
              wordTiming: true,
            })),
            sourceCount: words.length,
            omittedCount: 0,
          }
        : null,
  } as ReadContentDocument;
}

export function contentHashOf(video: EvalVideo): string {
  return crypto
    .createHash('sha256')
    .update(`eval-clip:${video.videoId}:${video.frames.map((f) => f.id).join(',')}`)
    .digest('hex');
}

function contentOf(video: EvalVideo): ReadContentResult {
  const clip = video.frames.length > 0;
  const snapshot = {
    rootSequenceId: 'seq',
    sequences: { seq: { id: 'seq', fps: { num: 30, den: 1 }, items: [], markers: [] } },
    assets: {
      a1: {
        id: 'a1',
        name: 'clip.mp4',
        currentRevision: 'r1',
        revisions: {
          r1: clip
            ? {
                storage: { mode: 'managed' },
                contentHash: contentHashOf(video),
                mediaType: 'video/mp4',
                duration: { ticks: video.frames.length * SLOT_SEC * 1000, timescale: 1000 },
                video: { width: 1280, height: 720 },
              }
            : { storage: { mode: 'managed' } },
        },
      },
    },
  } as unknown as VideoSnapshot;
  return { videoId: video.videoId, name: video.videoId, revision: 'r1', snapshot, documents: video.text ? [speechDoc(video)] : [] };
}

class EvalReader implements ContentReader {
  readonly byDir = new Map<string, EvalVideo>();
  async peek(dir: string) {
    const v = this.#get(dir);
    return { videoId: v.videoId, name: v.videoId, revision: 'r1' };
  }
  async readContent(dir: string) {
    return contentOf(this.#get(dir));
  }
  #get(dir: string): EvalVideo {
    const found = this.byDir.get(dir);
    if (!found) throw new Error('not a video');
    return found;
  }
}

/** 关键帧：把第 `floor(at / 8)` 张标注帧拷进 `imageRoot`（Provider 只读这里的图片）。 */
class EvalFrames implements KeyframeSource {
  readonly #byHash: Map<string, EvalVideo>;
  readonly #root: string;
  constructor(videos: readonly EvalVideo[], root: string) {
    this.#byHash = new Map(videos.filter((v) => v.frames.length > 0).map((v) => [contentHashOf(v), v]));
    this.#root = root;
  }
  async keyframe(_dir: string, asset: VisualAsset, at: number): Promise<string> {
    const video = this.#byHash.get(asset.contentHash);
    const frame = video?.frames[Math.floor(at / SLOT_SEC)];
    if (!frame) throw new Error('no frame at this time');
    const file = path.join(this.#root, asset.contentHash.slice(0, 16), `${Math.round(at * 1000)}${path.extname(frame.file) || '.jpg'}`);
    if (!(await fs.stat(file).catch(() => null))) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(frame.file, file);
    }
    return file;
  }
}

export interface EvalSpace {
  services: SemanticServices;
  close(): Promise<void>;
}

/** 在 `work` 下建内容索引与语义库，把 `dataset` 的视频建好索引（文字与画面都建）。 */
export async function openEvalSpace(
  dataset: EvalDataset,
  provider: EmbeddingProvider,
  work: string,
  imageRoot: string,
): Promise<EvalSpace> {
  const reader = new EvalReader();
  const videos: SpaceVideo[] = [];
  for (const video of dataset.videos) {
    const dir = path.join(work, 'videos', video.videoId);
    await fs.mkdir(dir, { recursive: true });
    const real = await fs.realpath(dir);
    reader.byDir.set(real, video);
    videos.push({
      entryId: `e-${video.videoId}`,
      dir: real,
      projectId: 'p-eval',
      conversationId: null,
      lastActivityAt: '2026-01-01T00:00:00Z',
      videoId: video.videoId,
    });
  }
  const index = new ContentIndex({ dir: path.join(work, 'cache', 'content-index'), reader, log: silentLogger });
  await index.load();
  await index.sync(videos.map((v) => ({ dir: v.dir, mtimeMs: 1 })));
  await index.idle();
  const services = openSemanticServices({
    cacheDir: path.join(work, 'cache'),
    catalog: { videos: () => videos, index, scanning: false },
    reader,
    provider,
    settings: () => ({ channels: ['text', 'visual'], indexedProjects: 'all' }),
    log: silentLogger,
    frames: new EvalFrames(dataset.videos, imageRoot),
    debounceMs: 0,
  });
  services.coordinator.start();
  await services.coordinator.idle();
  return {
    services,
    async close() {
      await services.close();
      await index.close?.();
    },
  };
}

// ---- 评分 ----

export interface RouteSpec {
  name: string;
  params: Pick<SpaceSearchV2Params, 'mode' | 'channels'>;
  /** 跑哪一种查询。 */
  target: 'text' | 'visual';
}

export const ROUTES: RouteSpec[] = [
  { name: 'text/hybrid', params: { mode: 'hybrid', channels: ['text'] }, target: 'text' },
  { name: 'text/semantic', params: { mode: 'semantic', channels: ['text'] }, target: 'text' },
  { name: 'text/lexical', params: { mode: 'lexical', channels: ['text'] }, target: 'text' },
  { name: 'text+visual/hybrid', params: { mode: 'hybrid', channels: ['text', 'visual'] }, target: 'text' },
  { name: 'visual/semantic', params: { mode: 'semantic', channels: ['visual'] }, target: 'visual' },
  { name: 'text+visual/hybrid', params: { mode: 'hybrid', channels: ['text', 'visual'] }, target: 'visual' },
];

/** 命中对上的答案身份：文字是视频；画面是窗口盖住的帧（可能几帧）。 */
export function answersOf(hit: SpaceSearchV2Hit): string[] {
  const videoId = hit.target.videoId;
  if (!videoId) return [];
  if (hit.target.kind !== 'asset-span') return [videoId];
  const out: string[] = [];
  const first = Math.max(0, Math.floor(hit.anchor.startSec / SLOT_SEC));
  for (let i = first; i * SLOT_SEC + SLOT_SEC / 2 <= hit.anchor.endSec; i++) {
    const at = i * SLOT_SEC + SLOT_SEC / 2;
    if (at >= hit.anchor.startSec) out.push(`${videoId}#${i}`);
  }
  return out;
}

export interface QueryResult {
  id: string;
  category: string;
  /** 第一条答案的名次（从 1 数）；前 20 条里没有时 null。 */
  firstRelevant: number | null;
  firstRelevantWeak: boolean | null;
  strong: number;
  hasAnswer: boolean;
}

export interface Metrics {
  queries: number;
  r1: number;
  r5: number;
  r10: number;
  mrr: number;
  strongPerQuery: number;
  /** 有答案、找到答案的查询里，第一条答案被标弱的比例。 */
  relevantWeak: number | null;
  /** 没有答案的查询里，至少一条没标弱的比例。 */
  noAnswerStrong: number | null;
}

export function metricsOf(results: readonly QueryResult[]): Metrics {
  const answered = results.filter((r) => r.hasAnswer);
  const none = results.filter((r) => !r.hasAnswer);
  const found = answered.filter((r) => r.firstRelevant !== null);
  const share = (n: number, d: number) => (d > 0 ? round(n / d) : 0);
  return {
    queries: results.length,
    r1: share(answered.filter((r) => r.firstRelevant === 1).length, answered.length),
    r5: share(answered.filter((r) => r.firstRelevant !== null && r.firstRelevant <= 5).length, answered.length),
    r10: share(answered.filter((r) => r.firstRelevant !== null && r.firstRelevant <= 10).length, answered.length),
    mrr: share(
      answered.reduce((sum, r) => sum + (r.firstRelevant ? 1 / r.firstRelevant : 0), 0),
      answered.length,
    ),
    strongPerQuery: share(
      results.reduce((sum, r) => sum + r.strong, 0),
      results.length,
    ),
    relevantWeak: found.length > 0 ? share(found.filter((r) => r.firstRelevantWeak).length, found.length) : null,
    noAnswerStrong: none.length > 0 ? share(none.filter((r) => r.strong > 0).length, none.length) : null,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface RouteReport {
  route: string;
  target: 'text' | 'visual';
  overall: Metrics;
  byCategory: Record<string, Metrics>;
  /** 请求失败的查询（原因码）。 */
  failures: Record<string, number>;
}

export async function runRoutes(
  space: EvalSpace,
  dataset: EvalDataset,
  routes: readonly RouteSpec[] = ROUTES,
): Promise<{ reports: RouteReport[]; details: Record<string, QueryResult[]> }> {
  const reports: RouteReport[] = [];
  const details: Record<string, QueryResult[]> = {};
  for (const route of routes) {
    const queries = dataset.queries.filter((q) => q.target === route.target);
    if (queries.length === 0) continue;
    const results: QueryResult[] = [];
    const failures: Record<string, number> = {};
    for (const query of queries) {
      let hits: SpaceSearchV2Hit[];
      try {
        const result = await space.services.search.searchV2(USER_VIEWER, {
          query: { kind: 'text', text: query.text },
          limit: TOP,
          ...route.params,
        });
        hits = result.hits;
      } catch (error) {
        const reason = String((error as { details?: { reason?: string } }).details?.reason ?? (error as Error).message);
        failures[reason] = (failures[reason] ?? 0) + 1;
        hits = [];
      }
      const relevant = new Set(query.relevant);
      const index = hits.findIndex((hit) => answersOf(hit).some((a) => relevant.has(a)));
      results.push({
        id: query.id,
        category: query.category,
        firstRelevant: index >= 0 ? index + 1 : null,
        firstRelevantWeak: index >= 0 ? hits[index]!.weak : null,
        strong: hits.filter((hit) => !hit.weak).length,
        hasAnswer: relevant.size > 0,
      });
    }
    const categories = [...new Set(results.map((r) => r.category))].sort();
    const name = `${route.name}:${route.target}`;
    details[name] = results;
    reports.push({
      route: route.name,
      target: route.target,
      overall: metricsOf(results),
      byCategory: Object.fromEntries(categories.map((c) => [c, metricsOf(results.filter((r) => r.category === c))])),
      failures,
    });
  }
  return { reports, details };
}

// ---- 命令行 ----

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function sha256File(file: string): Promise<string | null> {
  try {
    return crypto
      .createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  } catch {
    return null;
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const models = arg(argv, '--models');
  const tools = arg(argv, '--tools');
  if (!models || !tools)
    throw new Error(
      'usage: search-eval.ts --models <dir> --tools <dir> [--frames <dir>] [--work <dir>] [--out <file>] [--details <file>] [--label <name>]',
    );
  const frames = arg(argv, '--frames');
  const evalRoot = process.env.BAOCUT_EMBED_EVAL_ROOT ?? '/Volumes/ExtremeSSD/Models/embeddinggemma-2';
  const work = path.resolve(arg(argv, '--work') ?? path.join(evalRoot, 'search-eval'));
  await fs.mkdir(work, { recursive: true });

  // Provider：与 Runtime 同一套（模型目录只读：不安装、不自检）。
  const { ModelCatalog } = await import('@baocut/models');
  const { LocalEmbeddingProvider, LocalTranscribeProvider } = await import('@baocut/jobs');
  const { resolveModelWorkerCommand } = await import('../../packages/runtime-core/src/models/model-worker.ts');
  const worker = resolveModelWorkerCommand();
  if (!worker) throw new Error('model-worker not found (set BAOCUT_MODEL_WORKER or build it)');
  const imageRoot = path.join(work, 'frames');
  await fs.mkdir(imageRoot, { recursive: true });
  const catalog = new ModelCatalog({
    root: path.resolve(models),
    toolsDir: path.resolve(tools),
    workerAvailable: () => true,
    engineCacheDir: path.join(work, 'litertlm'),
  });
  const transcribe = new LocalTranscribeProvider({ catalog, command: () => worker, env: async () => process.env, idleMs: 60_000 });
  const provider = new LocalEmbeddingProvider({ catalog, worker: transcribe, imageRoots: [imageRoot] });

  const text = await textDataset();
  const visual = frames ? await frameDataset(path.resolve(frames)) : { videos: [], queries: [] };
  const dataset: EvalDataset = { videos: [...text.videos, ...visual.videos], queries: [...text.queries, ...visual.queries] };
  const started = Date.now();
  const space = await openEvalSpace(dataset, provider, work, imageRoot);
  const built = Date.now();
  try {
    const { reports, details } = await runRoutes(space, dataset);
    const textProfile = await provider.profile('retrieval').catch(() => null);
    const visualProfile = frames ? await provider.profile('text-to-visual').catch(() => null) : null;
    const output = {
      schema: 'baocut.search-eval/1',
      label: arg(argv, '--label') ?? null,
      rankingVersion: RANKING_VERSION,
      createdAt: new Date().toISOString(),
      manifest: {
        textVideos: text.videos.length,
        textQueries: text.queries.length,
        frameVideos: visual.videos.length,
        frames: visual.videos.reduce((n, v) => n + v.frames.length, 0),
        visualQueries: visual.queries.length,
        worker: { sha256: await sha256File(worker.command) },
        textProfile: textProfile?.encoderProfileId ?? null,
        visualProfile: visualProfile?.encoderProfileId ?? null,
        host: `${os.platform()}-${os.arch()}`,
        buildMs: built - started,
        searchMs: Date.now() - built,
      },
      routes: reports,
    };
    const out = arg(argv, '--out');
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (out) await fs.writeFile(out, json);
    else process.stdout.write(json);
    await fs.writeFile(
      arg(argv, '--details') ?? path.join(work, `details-${output.label ?? 'run'}.json`),
      `${JSON.stringify(details, null, 2)}\n`,
    );
  } finally {
    await space.close();
    await transcribe.close?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(1);
    },
  );
}
