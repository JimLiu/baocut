// 预览播放基准（`tools/preview-bench.mjs`）用的隔离 Runtime：由基准脚本用 node 启动，Home、项目与下载目录都在基准的临时目录里
// （`BAOCUT_HOME`、`BAOCUT_PROJECTS_DIR`、`BAOCUT_DOWNLOADS_DIR`）。不注册任何智能体 Driver、不起模型 Worker、不监视来源目录、
// 不广播也不发现局域网节点；凭据用明文文件后端（不碰钥匙串），外部工具的搜索路径只有一个空目录。
//
// 起好之后把 `--project` 给的目录登记为项目；`--synthetic <JSON>` 给的合成素材（`[{name, file, width, height, fps}]`）
// 各建一个视频：导入素材放上时间线，再放中英两条字幕（与导入字幕文件同一笔事务）。最后向 stdout 写一行
// `{"type":"ready","projectId":…,"videos":[{name, path}]}`；令牌不经 stdout，基准的 Electron 主进程从发现文件读。收到 SIGTERM 就停。

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BaoCutClient } from '@baocut/client';
import { startRuntime } from '@baocut/runtime-core';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { importCaptionOperations } from '../../../packages/ui/src/model/cue-edit.ts';
import { rootSequence } from '../../../packages/ui/src/model/editor.ts';

interface Synthetic {
  name: string;
  file: string;
  width: number;
  height: number;
  fps: number;
}

const { values } = parseArgs({ options: { project: { type: 'string' }, synthetic: { type: 'string', default: '[]' } } });
if (!values.project) throw new Error('缺少 --project');
const synthetic = JSON.parse(values.synthetic!) as Synthetic[];
const home = resolveRuntimeHome(process.env);
const emptyPath = path.join(home.root, 'empty-path');
await fs.mkdir(emptyPath, { recursive: true });

const runtime = await startRuntime({
  home,
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
  client: { kind: 'desktop', name: 'preview-bench', version: '0' },
  reconnect: false,
});
await client.connect();
const { project } = await client.request('projects.open', { path: values.project });

/** 字幕：每 1.5 秒一句，覆盖整段素材。 */
function cues(seconds: number, text: (index: number) => string) {
  return Array.from({ length: Math.floor(seconds / 1.5) }, (_, i) => ({ index: i + 1, start: i * 1.5, end: i * 1.5 + 1.4, text: text(i) }));
}

const videos: { name: string; path: string }[] = [];
for (const scene of synthetic) {
  const opened = await client.request('videos.create', {
    projectId: project.id,
    name: scene.name,
    fps: { num: scene.fps, den: 1 },
    width: scene.width,
    height: scene.height,
  });
  const { videoId } = opened.ref;
  let revision = opened.snapshot.video.revision;
  const apply = async (operations: unknown[]) => {
    const result = await client.request('edits.apply', {
      videoId,
      commandId: `cmd_${crypto.randomUUID().replaceAll('-', '')}`,
      expectedRevision: revision,
      operations: operations as never,
    });
    revision = result.receipt.videoRevision;
  };
  await apply([
    { type: 'importAsset', path: scene.file, ref: 'clip' },
    { type: 'addItem', sequenceId: opened.snapshot.video.rootSequenceId, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
  ]);
  const duration = 12;
  for (const [language, text] of [
    ['zh', (i: number) => `第 ${i + 1} 句：预览播放的基准字幕，逐句换行`],
    ['en', (i: number) => `Line ${i + 1}: a benchmark caption for preview playback`],
  ] as const) {
    const sequence = rootSequence(runtime.videos.mirror(videoId)!.video)!;
    await apply(importCaptionOperations(sequence, cues(duration, text), `字幕 ${language}`, language));
  }
  await client.request('videos.close', { videoId });
  videos.push({ name: scene.name, path: opened.ref.relPath });
}
client.close();
process.stdout.write(`${JSON.stringify({ type: 'ready', projectId: project.id, videos })}\n`);

const stop = () => void runtime.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
