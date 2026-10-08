// 导入之后的核对：逐个打开项目文件夹里的视频，确认素材都按原路径找得到、没有被复制进视频目录，文档正文都读得出来，
// 实例都是视频格式第 3 版的字段（没有旧的 `baocut.legacy-*` 包装，导入扩展里只剩来源说明），剪口集合的正文成立。
//
//   node scripts/legacy-import/verify.ts <项目文件夹> [--engine <engine-host>]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { EngineFailure, EngineHost } from './engine-host.ts';
import type { ProjectReport } from './video-plan.ts';

const { values, positionals } = parseArgs({ options: { engine: { type: 'string' }, ffprobe: { type: 'string' } }, allowPositionals: true });
const root = path.resolve(positionals[0] ?? '.');
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const engine = values.engine ?? path.join(repoRoot, 'target', 'release', 'engine-host');
const ffprobe = values.ffprobe ?? process.env.BAOCUT_FFPROBE ?? execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();

interface Snapshot {
  schemaVersion: number;
  name: string;
  rootSequenceId: string;
  assets: Record<string, { id: string; name: string; kind: string; currentRevision: string }>;
  documents: Record<string, { id: string; kind: string; name: string; sourceAssetId?: string }>;
  sequences: Record<string, { tracks: unknown[]; items: Record<string, unknown>[] }>;
}

const ITEM_TYPES = new Set([
  'video',
  'image',
  'audio',
  'text',
  'shape',
  'sticker',
  'visualizer',
  'progress',
  'draw',
  'placeholder',
  'confetti',
  'whiteboard',
  'composition',
  'caption',
]);
/** 导入扩展里允许留下的键：来源说明，不是元素数据（映射说明第 5 节）。 */
const IMPORT_KEYS = new Set(['sourceId', 'bcfClip', 'mediaId', 'itemCount']);

/** 剪口集合的正文：按 t0 排序、互不重叠、整数刻度、不超出素材。 */
function cutSetProblems(body: Record<string, any>, durationSeconds: number | undefined, items: Set<string>): string[] {
  const out: string[] = [];
  if (body.schema !== 'baocut.cut-set/1' || body.clock !== 'source-asset') out.push('schema 或 clock 不对');
  if (!Number.isSafeInteger(body.timescale) || body.timescale <= 0) out.push(`timescale 不是正整数：${body.timescale}`);
  let last = -1n;
  for (const cut of (body.cuts ?? []) as Record<string, any>[]) {
    if (!/^\d+$/.test(String(cut.t0)) || !/^\d+$/.test(String(cut.t1))) {
      out.push(`剪口 ${cut.id} 的刻度不是整数`);
      continue;
    }
    const [t0, t1] = [BigInt(cut.t0), BigInt(cut.t1)];
    if (t0 >= t1) out.push(`剪口 ${cut.id} 为空`);
    if (t0 < last) out.push(`剪口 ${cut.id} 与前一个重叠或没有排序`);
    last = t1;
    if (durationSeconds != null && Number(t1) / body.timescale > durationSeconds + 1e-6) out.push(`剪口 ${cut.id} 超出素材时长`);
  }
  for (const id of (body.scopeItemIds ?? []) as string[]) if (!items.has(id)) out.push(`作用实例 ${id} 不存在`);
  return out;
}

function bytesUnder(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

const host = new EngineHost(engine, ffprobe);
await host.request('host.hello', {});
const problems: string[] = [];
// 仅打开已写出的对象看不见被跳过的素材、实例或整个项目；同时核对本批导入报告。
const reportFile = path.join(root, 'import-report.json');
if (existsSync(reportFile)) {
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as { projects: ProjectReport[] };
  for (const project of report.projects) {
    const name = path.basename(project.source);
    if (!project.videoDir || !existsSync(path.join(root, path.basename(project.videoDir), 'video.db')))
      problems.push(`${name}：报告中的视频没有写出`);
    for (const failure of project.failed) problems.push(`${name}：导入失败：${failure}`);
    for (const missing of project.assets.missing) problems.push(`${name}：导入时缺失素材：${missing}`);
  }
}
let videos = 0;
const totals = { assets: 0, linked: 0, documents: 0, items: 0, blobBytes: 0 };
for (const entry of readdirSync(root).sort((a, b) => a.localeCompare(b))) {
  const dir = path.join(root, entry);
  if (!existsSync(path.join(dir, 'video.db'))) continue;
  videos++;
  const note = (text: string): number => problems.push(`${entry}：${text}`);
  try {
    const { videoId, snapshot } = await host.request<{ videoId: string; snapshot: Snapshot }>('videos.open', { path: dir });
    try {
      if (snapshot.schemaVersion !== 3) note(`schemaVersion 是 ${snapshot.schemaVersion}，不是 3`);
      for (const asset of Object.values(snapshot.assets)) {
        totals.assets++;
        const blob = await host.request<{ path: string; storage: string }>('assets.blobPath', { videoId, assetId: asset.id });
        if (blob.storage === 'linked') totals.linked++;
        else note(`素材 ${asset.name} 不是链接素材（${blob.storage}）`);
        if (!existsSync(blob.path)) note(`素材 ${asset.name} 的文件找不到：${blob.path}`);
        if (blob.path.startsWith(dir + path.sep)) note(`素材 ${asset.name} 在视频目录里：${blob.path}`);
      }
      for (const doc of Object.values(snapshot.documents)) {
        totals.documents++;
        const content = await host.request<{ body?: unknown }>('documents.read', { videoId, documentId: doc.id });
        if (content.body == null) note(`文档 ${doc.name}（${doc.kind}）读不出正文`);
        if (doc.kind === 'cut-set' && content.body != null) {
          const asset = doc.sourceAssetId ? snapshot.assets[doc.sourceAssetId] : undefined;
          const revision = (asset as { revisions?: Record<string, { duration?: { ticks: string; timescale: number } }> } | undefined)
            ?.revisions?.[asset?.currentRevision ?? ''];
          const duration = revision?.duration ? Number(revision.duration.ticks) / revision.duration.timescale : undefined;
          const ids = new Set(snapshot.sequences[snapshot.rootSequenceId].items.map((item) => String(item.id)));
          for (const text of cutSetProblems(content.body as Record<string, any>, duration, ids)) note(`剪口集合 ${doc.name}：${text}`);
        }
      }
      const items = snapshot.sequences[snapshot.rootSequenceId].items;
      totals.items += items.length;
      for (const item of items) {
        if (!ITEM_TYPES.has(String(item.type))) note(`实例 ${String(item.id)} 的类型 ${String(item.type)} 不认识`);
        for (const key of ['style', 'shape', 'parameterValues'] as const) {
          const schema = (item[key] as { schema?: unknown } | undefined)?.schema;
          if (typeof schema === 'string' && schema.startsWith('baocut.legacy'))
            note(`实例 ${String(item.id)} 的 ${key} 还是旧的包装 ${schema}`);
        }
        const imported = (item.extensions as Record<string, Record<string, unknown>> | undefined)?.['baocut.import'] ?? {};
        const extra = Object.keys(imported).filter((key) => !IMPORT_KEYS.has(key));
        if (extra.length > 0) note(`实例 ${String(item.id)} 的导入扩展里有元素数据：${extra.join('、')}`);
        const policy = item.followPolicy as { kind?: string; start?: { speechRef?: { id: string } }; end?: { speechRef?: { id: string } } };
        for (const anchor of [policy?.start, policy?.end]) {
          if (anchor?.speechRef && !snapshot.documents[anchor.speechRef.id]) note(`实例 ${String(item.id)} 的词锚点指向不存在的文档`);
        }
        const refs = [item.assetRef, item.prerender, (item.source as { assetRef?: unknown } | undefined)?.assetRef] as (
          { id: string } | undefined
        )[];
        for (const ref of refs) if (ref && !snapshot.assets[ref.id]) note(`实例 ${String(item.id)} 引用的素材 ${ref.id} 不存在`);
        for (const id of [item.documentId, item.styleDocumentId] as (string | undefined)[]) {
          if (id && !snapshot.documents[id]) note(`实例 ${String(item.id)} 引用的文档 ${id} 不存在`);
        }
      }
      const blobBytes = bytesUnder(path.join(dir, 'blobs'));
      totals.blobBytes += blobBytes;
      if (blobBytes > 0) note(`blobs/ 里有 ${blobBytes} 字节`);
    } finally {
      await host.request('videos.close', { videoId });
    }
  } catch (error) {
    if (!(error instanceof EngineFailure)) throw error;
    note(`${error.body.code} ${error.body.message}`);
  }
}
host.close();
if (videos === 0) problems.push('没有找到任何视频');

process.stdout.write(
  `视频 ${videos} 部；素材 ${totals.assets} 个，其中链接 ${totals.linked} 个；文档 ${totals.documents} 份（正文都读过）；实例 ${totals.items} 个；blobs/ 合计 ${totals.blobBytes} 字节\n`,
);
for (const text of problems) process.stdout.write(`✗ ${text}\n`);
if (problems.length === 0) process.stdout.write('✓ 没有发现问题\n');
else process.exitCode = 1;
