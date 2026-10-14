/**
 * 参考向量回归（检索规格 v0.1 §5.3）：`encoderProfileId` 不带 LiteRT-LM 的版本号，只带向量兼容标签
 * （`EMBEDDING_VECTOR_COMPAT`）。升级 LiteRT-LM、换编译选项或换 Worker 之后，用本机装好的模型包把几句固定的文字与一张合成帧
 * 重新编码，与 `fixtures/reference-vectors.json` 里存的向量比：每一条余弦都不低于 `REFERENCE_MIN_COSINE` 时旧索引照用；
 * 有一条低于它，就把标签加一（`vec-v2`……，旧的向量随之不再比较、索引重建），再用 `--write` 重新生成参考。
 *
 * 参考按「平台 / 设备 / 模型包」分开存：只在同一平台、同一设备上比较，别的平台第一次跑时 `--write` 补上。
 *
 *    node --experimental-strip-types tools/embedding-eval/reference-vectors.ts --models <dir> --tools <dir> [--write]
 *
 * 不带 `--write` 时只比较，有不一致就以非零退出；`tools/embedding-reference.test.ts` 在设了 `BAOCUT_EMBED_REFERENCE_MODELS`
 * 与 `BAOCUT_EMBED_REFERENCE_TOOLS` 时做同样的比较（CI 上没有模型，跳过）。模型目录只读：不安装、不自检。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmbeddingProvider } from '@baocut/models';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCE_FILE = path.join(HERE, 'fixtures', 'reference-vectors.json');
export const REFERENCE_FRAME = path.join(HERE, 'fixtures', 'reference-frame.jpg');

/** 同一份输入，新旧向量的余弦至少这么多才算同一个编码实现（参考存 6 位小数，舍入误差远小于它）。 */
export const REFERENCE_MIN_COSINE = 0.9999;

/** 参考里的文字：语料里的几句（中、英，文档）与查询里的几句（查询前缀）。 */
const TEXTS: { id: string; role: 'query' | 'document'; source: 'corpus' | 'queries' }[] = [
  { id: 'ms-01', role: 'document', source: 'corpus' },
  { id: 'pr-01', role: 'document', source: 'corpus' },
  { id: 'q-ex-01', role: 'query', source: 'queries' },
  { id: 'q-ex-02', role: 'query', source: 'queries' },
];

export interface ReferenceVector {
  id: string;
  kind: 'text' | 'image';
  role: 'query' | 'document' | null;
  vector: number[];
}

export interface ReferenceEntry {
  bundleId: string;
  encoderProfileId: { text: string; image: string | null };
  /** 生成这份参考时的 LiteRT-LM 版本（只记录，不参与比较）。 */
  litertlmVersion: string;
  createdAt: string;
  vectors: ReferenceVector[];
}

export interface ReferenceFile {
  schema: 'baocut.embedding-reference/1';
  /** `<平台>/<设备>/<模型包>` → 参考。 */
  entries: Record<string, ReferenceEntry>;
}

export async function referenceTexts(): Promise<{ id: string; role: 'query' | 'document'; text: string }[]> {
  const corpus = JSON.parse(await fs.readFile(path.join(HERE, 'fixtures', 'corpus.json'), 'utf8')) as { groups: { id: string; text: string }[] };
  const queries = JSON.parse(await fs.readFile(path.join(HERE, 'fixtures', 'queries.json'), 'utf8')) as { queries: { id: string; text: string }[] };
  return TEXTS.map(({ id, role, source }) => {
    const text = (source === 'corpus' ? corpus.groups : queries.queries).find((item) => item.id === id)?.text;
    if (!text) throw new Error(`reference text ${id} not found in ${source}.json`);
    return { id, role, text };
  });
}

export async function readReference(): Promise<ReferenceFile> {
  try {
    return JSON.parse(await fs.readFile(REFERENCE_FILE, 'utf8')) as ReferenceFile;
  } catch {
    return { schema: 'baocut.embedding-reference/1', entries: {} };
  }
}

export function referenceKey(bundleId: string, device: string): string {
  return `${os.platform()}-${os.arch()}/${device}/${bundleId}`;
}

/** 用这个模型包编码参考输入。`imageRoot` 必须是参考帧所在的目录（Provider 只读登记过的目录里的图片）。 */
export async function computeReference(
  provider: EmbeddingProvider,
  options: { vision: boolean },
): Promise<{ vectors: ReferenceVector[]; text: string; image: string | null }> {
  const texts = await referenceTexts();
  const vectors: ReferenceVector[] = [];
  for (const role of ['document', 'query'] as const) {
    const items = texts.filter((t) => t.role === role);
    const result = await provider.embed('retrieval', { role, inputs: items.map((t) => ({ text: t.text })) });
    items.forEach((t, i) => vectors.push({ id: t.id, kind: 'text', role, vector: rounded(result.vectors[i]!) }));
  }
  const textProfile = await provider.profile('retrieval');
  let image: string | null = null;
  if (options.vision) {
    const result = await provider.embedImages!({ images: [REFERENCE_FRAME] });
    vectors.push({ id: 'reference-frame', kind: 'image', role: null, vector: rounded(result.vectors[0]!) });
    image = (await provider.profile('text-to-visual')).encoderProfileId;
  }
  return { vectors, text: textProfile.encoderProfileId, image };
}

/** 比较：返回低于 `REFERENCE_MIN_COSINE` 的那几条（空数组表示一致）。 */
export function compareReference(expected: readonly ReferenceVector[], actual: readonly ReferenceVector[]): { id: string; cosine: number }[] {
  const bad: { id: string; cosine: number }[] = [];
  for (const want of expected) {
    const got = actual.find((v) => v.id === want.id && v.kind === want.kind);
    const cosine = got ? cosineOf(want.vector, got.vector) : 0;
    if (!(cosine >= REFERENCE_MIN_COSINE)) bad.push({ id: `${want.kind}:${want.id}`, cosine });
  }
  return bad;
}

function cosineOf(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

function rounded(vector: Float32Array): number[] {
  return Array.from(vector, (x) => Math.round(x * 1e6) / 1e6);
}

/** 本机装好的 embedding 模型包，各建一个只用它的 Provider（模型目录只读）。 */
export async function openProviders(models: string, tools: string, work: string) {
  const { ModelCatalog, LITERTLM_VERSION } = await import('@baocut/models');
  const { LocalEmbeddingProvider, LocalTranscribeProvider } = await import('@baocut/jobs');
  const { resolveModelWorkerCommand } = await import('../../packages/runtime-core/src/models/model-worker.ts');
  const worker = resolveModelWorkerCommand();
  if (!worker) throw new Error('model-worker not found (set BAOCUT_MODEL_WORKER or build it)');
  const catalog = new ModelCatalog({ root: path.resolve(models), toolsDir: path.resolve(tools), workerAvailable: () => true, engineCacheDir: work });
  const transcribe = new LocalTranscribeProvider({ catalog, command: () => worker, env: async () => process.env, idleMs: 60_000 });
  const statuses = await Promise.all(
    catalog
      .definitions()
      .filter((d) => d.capability === 'embed' && d.embedding !== undefined)
      .map(async (d) => ({ def: d, status: await catalog.status(d.bundleId) })),
  );
  const bundles = statuses
    .filter(({ status }) => status !== null && ['installed', 'loading', 'ready', 'busy', 'unloading'].includes(status.state))
    .map(({ def }) => ({
      bundleId: def.bundleId,
      vision: def.embedding!.modalities.includes('image') && def.embedding!.vision !== undefined,
      provider: new LocalEmbeddingProvider({
        catalog,
        worker: transcribe,
        selected: () => def.bundleId,
        imageRoots: [path.dirname(REFERENCE_FRAME)],
      }),
    }));
  return { bundles, litertlmVersion: LITERTLM_VERSION, close: () => transcribe.close() };
}

async function main(argv: readonly string[]): Promise<void> {
  const at = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const models = at('--models');
  const tools = at('--tools');
  if (!models || !tools) throw new Error('usage: reference-vectors.ts --models <dir> --tools <dir> [--write]');
  const write = argv.includes('--write');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-embed-reference-'));
  const opened = await openProviders(models, tools, work);
  const file = await readReference();
  let failed = false;
  try {
    if (opened.bundles.length === 0) throw new Error('no embedding bundle installed in --models');
    for (const bundle of opened.bundles) {
      const computed = await computeReference(bundle.provider, { vision: bundle.vision });
      const key = referenceKey(bundle.bundleId, (await bundle.provider.profile('retrieval')).device ?? 'cpu');
      const stored = file.entries[key];
      if (write) {
        file.entries[key] = {
          bundleId: bundle.bundleId,
          encoderProfileId: { text: computed.text, image: computed.image },
          litertlmVersion: opened.litertlmVersion,
          createdAt: new Date().toISOString(),
          vectors: computed.vectors,
        };
        console.log(`${key}: wrote ${computed.vectors.length} vectors`);
        continue;
      }
      if (!stored) {
        console.log(`${key}: no reference yet (run with --write)`);
        failed = true;
        continue;
      }
      const bad = compareReference(stored.vectors, computed.vectors);
      if (bad.length) failed = true;
      console.log(
        bad.length ? `${key}: CHANGED ${bad.map((b) => `${b.id} ${b.cosine.toFixed(6)}`).join(', ')}` : `${key}: ok (${stored.vectors.length} vectors)`,
      );
    }
    if (write) await fs.writeFile(REFERENCE_FILE, JSON.stringify(file) + '\n');
  } finally {
    await opened.close();
    await fs.rm(work, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
