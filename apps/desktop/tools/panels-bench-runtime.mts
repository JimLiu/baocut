// 面板基准（`tools/panels-bench.mjs`）用的隔离 Runtime：由基准脚本用 node 启动，Home、项目与下载目录都在基准的临时目录里
// （`BAOCUT_HOME`、`BAOCUT_PROJECTS_DIR`、`BAOCUT_DOWNLOADS_DIR`）。与预览基准的隔离一样：不注册任何智能体 Driver、不起模型 Worker、
// 不监视来源目录、不广播也不发现局域网节点；凭据用明文文件后端（不碰钥匙串），外部工具的搜索路径只有一个空目录。
// 页面从基准的本地 HTTP 服务载入，网关只放行 `--origin` 给的那一个来源。
//
// 起好之后按 `--tiers <JSON>`（`[{tier, project, video, media, cues, clips, dubs}]`）每档建一个项目和一个视频，
// 全是程序化生成的夹具：逐词的转写、按素材时钟的字幕与一份中文译文，在源素材上切 clips-1 个剪口（时间线上成 clips 个片段），
// 配音轨上放 dubs 个配音块。素材由基准脚本用 ffmpeg 生成，硬链接进项目目录。
// 最后向 stdout 写一行 `{"type":"ready","tiers":[…]}`，带上每档实际建成的规模；令牌不经 stdout，基准脚本从发现文件读。收到 SIGTERM 就停。

import { copyFileSync, linkSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BaoCutClient } from '@baocut/client';
import { startRuntime } from '@baocut/runtime-core';
import { resolveRuntimeHome } from '@baocut/runtime-storage';

interface Tier {
  tier: string;
  project: string;
  video: string;
  media: string;
  cues: number;
  clips: number;
  dubs: number;
}

const { values } = parseArgs({ options: { tiers: { type: 'string' }, origin: { type: 'string' } } });
if (!values.tiers || !values.origin) throw new Error('缺少 --tiers 或 --origin');
const tiers = JSON.parse(values.tiers) as Tier[];
const home = resolveRuntimeHome(process.env);
const emptyPath = path.join(home.root, 'empty-path');
await fs.mkdir(emptyPath, { recursive: true });

const runtime = await startRuntime({
  home,
  // 页面不是 file://，是本地 HTTP 服务上的生产构建：网关只认这一个来源。
  allowedOrigins: [values.origin],
  drivers: () => [],
  watchSpace: false,
  engineHost: process.env.BAOCUT_ENGINE_HOST || undefined,
  modelWorker: null,
  credentials: 'file',
  initiator: { discoverer: null },
  nodes: { host: '127.0.0.1', advertiser: null },
  externalTools: { env: async () => ({ PATH: emptyPath }), overrides: {}, lookup: async () => ['127.0.0.1'] },
});
const { endpoint, token } = runtime.discovery;
const client = new BaoCutClient({
  resolve: async () => ({ endpoint, token }),
  client: { kind: 'cli', name: 'panels-bench', version: '0' },
  reconnect: false,
});
await client.connect();
const id = () => crypto.randomUUID();

/** 转写的词表（程序化的英文句子；每 9 句放一个 marker，全部替换时有成百上千处命中）。 */
const LEXICON =
  'today we talk about how the editor follows the transcript while the video plays and every word lights up in turn so you can read along with the speaker without losing your place'.split(
    ' ',
  );

// 序列与片段只读几个字段，类型从宽。
interface SequenceView {
  id: string;
  fps: { num: number; den: number };
  items: Array<{ id: string; type: string; span?: { fromFrame: number; durationFrames: number } }>;
}

async function seed(tier: Tier) {
  const { project } = await client.request('projects.create', { name: tier.project, commandId: id() });
  const mediaName = path.basename(tier.media);
  const mediaPath = path.join(project.path, mediaName);
  try {
    linkSync(tier.media, mediaPath);
  } catch {
    copyFileSync(tier.media, mediaPath);
  }
  const opened = await client.request('videos.create', { projectId: project.id, name: tier.video, commandId: id() });
  let video = opened.snapshot.video;

  // 句长 3–10 词循环，每词 0.27 秒、句间 0.4 秒；基准脚本按同一个算法先算出片长再生成素材。
  const words: Array<Record<string, unknown>> = [];
  const cues: Array<Record<string, unknown>> = [];
  const units: Array<Record<string, unknown>> = [];
  let t = 0.3;
  let n = 0;
  for (let s = 0; s < tier.cues; s++) {
    const len = 3 + ((s * 7) % 8);
    const speaker = Math.floor(s / 10) % 2 ? 's2' : 's1';
    const first = n + 1;
    const start = t;
    const parts: string[] = [];
    for (let k = 0; k < len; k++) {
      let text = LEXICON[(n * 5 + k * 3) % LEXICON.length]!;
      if (k === 0) text = text[0]!.toUpperCase() + text.slice(1);
      if (k === 1 && s % 9 === 0) text = 'marker';
      if (k === len - 1) text += '.';
      parts.push(text);
      words.push({
        id: `w-${String(++n).padStart(6, '0')}`,
        start: Math.round(t * 1000),
        end: Math.round((t + 0.25) * 1000),
        text: (words.length ? ' ' : '') + text,
        speaker,
      });
      t += 0.27;
    }
    const end = s % 13 === 0 ? start + 0.6 : t;
    cues.push({
      id: `c${s + 1}`,
      start: Math.round(start * 1000),
      end: Math.round(end * 1000),
      text: parts.join(' '),
      speaker: speaker === 's1' ? 'Host' : 'Guest',
    });
    // 译文中英混排，行高估计两种文字都要走到。
    units.push({
      id: `u${s + 1}`,
      sourceSentenceId: `s-w-${String(first).padStart(6, '0')}`,
      sourceFingerprint: 'x',
      naturalText: `译文第 ${s + 1} 句：${parts.slice(0, 4).join(' ')}，后面再接一小段中文说明。`,
    });
    t += 0.4;
  }

  let videoId = opened.ref.videoId;
  const apply = async (label: string, operations: unknown[]) => {
    const result = await client.request('edits.apply', {
      videoId,
      commandId: id(),
      expectedRevision: video.revision,
      label,
      operations: operations as never,
    });
    return result.receipt;
  };
  // 每笔编辑之后重开视频，取新的快照（修订号、序列里的片段）。
  const reopen = async () => {
    await client.request('videos.close', { videoId });
    const again = await client.request('videos.open', { projectId: project.id, path: opened.ref.relPath });
    videoId = again.ref.videoId;
    video = again.snapshot.video;
    return video.sequences[video.rootSequenceId] as unknown as SequenceView;
  };

  const receipt = await apply('放入素材与转写', [
    { type: 'importAsset', path: mediaPath, ref: 'v' },
    { type: 'addItem', sequenceId: video.rootSequenceId, asset: { ref: 'v' }, alignment: 'exact-frame' },
    {
      type: 'putDocument',
      ref: 'speech',
      kind: 'speech',
      name: 'talk',
      language: 'en',
      sourceAsset: { ref: 'v' },
      body: {
        schema: 'baocut.speech/1',
        clock: 'source-asset',
        timescale: 1000,
        speakers: [
          { id: 's1', name: 'Host' },
          { id: 's2', name: 'Guest' },
        ],
        words,
      },
    },
  ]);
  const assetId = receipt.refs!.v!;
  const speechId = receipt.refs!.speech!;
  let sequence = await reopen();
  const clip = sequence.items.find((item) => item.type === 'video')!;
  const fps = sequence.fps.num / sequence.fps.den;
  await apply('字幕与译文', [
    { type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: 'track', name: '字幕' },
    {
      type: 'putDocument',
      ref: 'cap',
      kind: 'caption',
      name: 'talk 字幕',
      language: 'en',
      sourceAsset: { assetId },
      sourceDocument: { documentId: speechId },
      body: { schema: 'baocut.caption/1', clock: 'source-asset', timescale: 1000, cues },
      summary: { cueCount: cues.length },
    },
    {
      type: 'insertItems',
      sequenceId: sequence.id,
      items: [
        {
          type: 'caption',
          name: 'talk 字幕',
          span: { fromFrame: 0, durationFrames: Math.ceil(t * fps) },
          documentRef: 'cap',
          trackRef: 'track',
          scopeItemIds: [clip.id],
        },
      ],
    },
    {
      type: 'putDocument',
      kind: 'translation',
      name: 'talk 中文',
      language: 'zh-CN',
      sourceDocument: { documentId: speechId },
      body: {
        schema: 'baocut.translation/2',
        language: 'zh-CN',
        sourceBasis: { speechRef: { id: speechId, revision: 'r' }, sequenceId: sequence.id, scopeLineage: [], editViewHash: 'x' },
        units,
      },
    },
  ]);

  // 剪口：在转写覆盖的源区间里均匀切 clips-1 刀，每刀 0.3 秒。
  if (tier.clips > 1) {
    sequence = await reopen();
    const step = t / tier.clips;
    const cuts = Array.from({ length: tier.clips - 1 }, (_, k) => {
      const from = (k + 1) * step - 0.15;
      return { from: from.toFixed(3), to: (from + 0.3).toFixed(3) };
    });
    await apply('剪口', [{ type: 'addCuts', sequenceId: sequence.id, assetId, cuts }]);
  }

  // 配音：新开一条音频轨，dubs 个配音块在整条时间线上均匀铺开，每块最长 1.6 秒。
  if (tier.dubs > 0) {
    sequence = await reopen();
    const total = Math.max(...sequence.items.map((item) => (item.span?.fromFrame ?? 0) + (item.span?.durationFrames ?? 0)));
    const spacing = Math.floor(total / tier.dubs);
    const ms = Math.min(1600, Math.floor(((spacing - 1) / fps) * 1000));
    const asset = video.assets[assetId] as { currentRevision?: string } | undefined;
    const items = Array.from({ length: tier.dubs }, (_, k) => ({
      type: 'audio',
      name: `配音 ${k + 1}`,
      assetRef: { id: assetId, revision: asset?.currentRevision ?? '1' },
      fromFrame: k * spacing,
      subframeOffset: { ticks: '0', timescale: 1000 },
      playDuration: { ticks: String(ms), timescale: 1000 },
      timeMap: {
        kind: 'linear',
        sourceIn: { ticks: String(Math.round((k * spacing * 1000) / fps)), timescale: 1000 },
        rate: { num: 1, den: 1 },
      },
      mix: { volume: 1 },
      trackRef: 'dub',
      extensions: { 'baocut.dub': { groupId: 'g-bench', language: 'zh-CN', unitId: `u${k + 1}` } },
    }));
    await apply('配音', [
      { type: 'addTrack', sequenceId: sequence.id, kind: 'audio', ref: 'dub', name: '配音' },
      { type: 'insertItems', sequenceId: sequence.id, items },
    ]);
  }

  // 实际建成的规模：件按类型数，片长取所有件的最远结束帧。
  sequence = await reopen();
  const items: Record<string, number> = {};
  for (const item of sequence.items) items[item.type] = (items[item.type] ?? 0) + 1;
  const frames = Math.max(...sequence.items.map((item) => (item.span?.fromFrame ?? 0) + (item.span?.durationFrames ?? 0)));
  await client.request('videos.close', { videoId });
  return {
    tier: tier.tier,
    video: tier.video,
    cues: cues.length,
    words: words.length,
    translations: units.length,
    transcriptSeconds: Number(t.toFixed(2)),
    items,
    cuts: Math.max(0, tier.clips - 1),
    seconds: Number((frames / fps).toFixed(2)),
  };
}

const seeded = [];
for (const tier of tiers) seeded.push(await seed(tier));
client.close();
// 不监视来源目录：建完再扫一遍，Space 里才有这几个视频（页面从 Space 打开它们）。
await runtime.space.rescan();
process.stdout.write(`${JSON.stringify({ type: 'ready', tiers: seeded })}\n`);

const stop = () => void runtime.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
