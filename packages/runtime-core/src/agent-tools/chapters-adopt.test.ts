import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { editorWasmAvailable } from '@baocut/jobs';
import { MCP_SERVICE_TOOL_NAMES, type CatalogCallResult, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { TOOL_RISK } from './tool-scope.ts';
import type { Loose } from './testing/fake-agent.ts';

/**
 * `chapters_adopt` 端到端（架构设计 §7.9）：链接导入的素材在来源里带着平台章节，经终端的 `catalog.call` 吸附到转写、
 * 投影到时间线、编译成一个 `setChapters` 落到真实的引擎里。需要 engine-host、ffmpeg 与构建好的 editor-wasm，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** 30 秒的转写：0 秒起 a 两句；10 秒起 b 一句；20 秒 a、21 秒 b 各一句（同一秒窗里两个段落起点）。 */
const speech = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
  words: [
    { id: 'w0', start: 0, end: 400, text: 'Hello', speaker: 'a' },
    { id: 'w1', start: 400, end: 800, text: 'everyone.', speaker: 'a' },
    { id: 'w2', start: 1000, end: 1400, text: 'Welcome', speaker: 'a' },
    { id: 'w3', start: 1400, end: 1800, text: 'back.', speaker: 'a' },
    { id: 'w4', start: 10_000, end: 10_400, text: 'Now', speaker: 'b' },
    { id: 'w5', start: 10_400, end: 10_800, text: 'the', speaker: 'b' },
    { id: 'w6', start: 10_800, end: 11_200, text: 'demo.', speaker: 'b' },
    { id: 'w7', start: 20_000, end: 20_400, text: 'Questions?', speaker: 'a' },
    { id: 'w8', start: 21_000, end: 21_400, text: 'Yes.', speaker: 'b' },
  ],
  sentences: null,
  chapters: [],
};

/** 平台给的章节：Demo 写早了一秒，Outro 附近没有话。 */
const source = {
  url: 'https://example.com/watch?v=1',
  webpageUrl: 'https://example.com/watch?v=1',
  platform: 'example',
  title: 'Talk',
  uploader: 'Someone',
  description: 'A talk.',
  chapters: [
    { start: 0, end: 9, title: 'Intro' },
    { start: 9, end: 20, title: 'Demo' },
    { start: 20, end: 27, title: 'Q&A' },
    { start: 27, end: 30, title: 'Outro' },
  ],
};

describe.skipIf(!engine || !ffmpeg || !editorWasmAvailable())('chapters_adopt（终端目录，真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-chapters-adopt-fixtures-'));
    clip = path.join(fixtures, 'talk.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=30'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-chapters-adopt-')));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '采用章节' }));
    await fs.mkdir(path.join(project.path, 'media'));
    await fs.copyFile(clip, path.join(project.path, 'media', 'talk.mp4'));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function call(name: string, args: unknown): Promise<CatalogCallResult> {
    return client.request('catalog.call', { name, args, cwd: project.path });
  }

  async function ok(name: string, args: unknown): Promise<Loose> {
    const outcome = await call(name, args);
    if (!outcome.ok) throw new Error(`${name} 失败：${JSON.stringify(outcome.error)}`);
    return outcome.result;
  }

  async function code(name: string, args: unknown): Promise<string | undefined> {
    const outcome = await call(name, args);
    return outcome.ok ? undefined : outcome.error.code;
  }

  const video = (videoId: Id) => runtime.videos.mirror(videoId)!.video;
  const chapters = (videoId: Id) =>
    video(videoId)
      .sequences[video(videoId).rootSequenceId]!.markers.filter((marker) => marker.kind === 'chapter')
      .map((marker) => ({ frame: marker.frame, label: marker.label }));

  /** 新建视频，导入 talk.mp4（`provenance` 给了时记成那样的来源）；`place` 时放到 0 秒；`transcript` 时写上转写。 */
  async function talkVideo(options: {
    provenance?: unknown;
    place?: boolean;
    transcript?: boolean;
  }): Promise<{ videoId: Id; assetId: Id }> {
    const created = await ok('videos_create', { name: '讲座' });
    const videoId = created.videoId as Id;
    await ok('edits_apply', {
      video: videoId,
      expectedRevision: created.revision,
      label: '导入讲座',
      operations: [
        { type: 'importAsset', path: 'media/talk.mp4', ref: 'talk', ...(options.provenance ? { provenance: options.provenance } : {}) },
        ...(options.place === false ? [] : [{ type: 'addItem', asset: { ref: 'talk' }, at: 0 }]),
      ],
    });
    const assetId = Object.keys(video(videoId).assets)[0]!;
    if (options.transcript !== false) {
      await ok('documents_put', { video: videoId, kind: 'speech', language: 'en', sourceAsset: assetId, body: speech });
    }
    return { videoId, assetId };
  }

  it('注册：MCP 工具清单与风险，与 edits_apply 同级', async () => {
    expect(TOOL_RISK.chapters_adopt).toBe(TOOL_RISK.edits_apply);
    expect(MCP_SERVICE_TOOL_NAMES).toContainEqual({ name: 'chapters_adopt', title: '采用来源章节', effect: 'mutation' });
    const { tools } = await client.request('catalog.list', {});
    expect(tools.map((t) => t.name)).toContain('chapters_adopt');
  });

  it('来源章节吸附到转写：matched、ambiguous、unanchored；dryRun 不改视频，提交是一笔 setChapters', async () => {
    const { videoId, assetId } = await talkVideo({ provenance: { origin: 'link-import', source } });
    const before = video(videoId).revision;

    const plan = await ok('chapters_adopt', { video: videoId, dryRun: true });
    expect(video(videoId).revision).toBe(before);
    expect(chapters(videoId)).toEqual([]);
    expect(plan).toMatchObject({ committed: false, revision: before, assetId, documentId: expect.any(String) });
    expect(plan.chapters).toEqual([
      { at: 0, title: 'Intro' },
      { at: 10, title: 'Demo' },
      { at: 20, title: 'Q&A' },
      { at: 27, title: 'Outro' },
    ]);
    expect(plan.sourceChapters).toMatchObject({ entries: 4, matched: 2, ambiguous: 1, snapped: 0, unanchored: 1 });
    const [intro, demo, qa, outro] = plan.sourceChapters.rows as Loose[];
    expect(intro).toMatchObject({ title: 'Intro', at: 0, sourceAt: 0, status: 'matched', anchor: { tier: 'paragraph' } });
    // 作者写的 9 秒吸到 10 秒的段落起点。
    expect(demo).toMatchObject({ title: 'Demo', at: 10, sourceAt: 10, status: 'matched', anchor: { tier: 'paragraph' } });
    expect(demo.anchor.snippet).toMatch(/^Now the demo\./);
    expect(qa).toMatchObject({ title: 'Q&A', at: 20, status: 'ambiguous', anchor: { tier: 'paragraph' } });
    expect(outro).toEqual({ title: 'Outro', at: 27, sourceAt: 27, status: 'unanchored' });

    const committed = await ok('chapters_adopt', { video: videoId, asset: assetId });
    expect(committed).toMatchObject({ status: 'committed', label: '采用来源章节', sourceChapters: { entries: 4, matched: 2 } });
    expect(committed.revision).toEqual({ before, after: video(videoId).revision });
    expect(chapters(videoId)).toEqual([
      { frame: 0, label: 'Intro' },
      { frame: 300, label: 'Demo' },
      { frame: 600, label: 'Q&A' },
      { frame: 810, label: 'Outro' },
    ]);

    // 再采用一次是整个替换（不叠加），说明可以自己给。
    await ok('chapters_adopt', { video: videoId, outline: [{ at: 0, title: 'Only' }], label: '只留一章' });
    expect(chapters(videoId)).toEqual([{ frame: 0, label: 'Only' }]);
  });

  it('落在剪口里的章节标 offTimeline、记 unanchored，落到剪口之后的片段起点', async () => {
    const { videoId, assetId } = await talkVideo({ provenance: { origin: 'link-import', source } });
    await ok('edits_apply', {
      video: videoId,
      expectedRevision: video(videoId).revision,
      label: '剪掉演示',
      operations: [{ type: 'addCuts', assetId, cuts: [{ from: 9.5, to: 15 }] }],
    });
    const plan = await ok('chapters_adopt', { video: videoId, dryRun: true });
    expect(plan.chapters).toEqual([
      { at: 0, title: 'Intro' },
      { at: 9.5, title: 'Demo' },
      { at: 14.5, title: 'Q&A' },
      { at: 21.5, title: 'Outro' },
    ]);
    expect(plan.sourceChapters.rows[1]).toEqual({ title: 'Demo', at: 9.5, sourceAt: 10, status: 'unanchored', offTimeline: true });
    expect(plan.sourceChapters).toMatchObject({ matched: 1, ambiguous: 1, unanchored: 2 });
  });

  it('显式大纲优先于来源；没有转写时不吸附', async () => {
    const { videoId } = await talkVideo({ transcript: false });
    const plan = await ok('chapters_adopt', { video: videoId, outline: '0:00 开场\n0:09 演示\n0:20 问答', dryRun: true });
    expect(plan.chapters).toEqual([
      { at: 0, title: '开场' },
      { at: 9, title: '演示' },
      { at: 20, title: '问答' },
    ]);
    expect(plan.sourceChapters).toMatchObject({ entries: 3, unanchored: 3 });
    expect(plan.notes).toEqual(expect.arrayContaining([expect.stringContaining('没有转写')]));
  });

  it('拒绝：没有来源章节（NO_SOURCE_CHAPTERS）、素材不在时间线上（ASSET_NOT_PLACED）', async () => {
    const plain = await talkVideo({});
    expect(await code('chapters_adopt', { video: plain.videoId })).toBe('NO_SOURCE_CHAPTERS');
    expect(await code('chapters_adopt', { video: plain.videoId, asset: plain.assetId })).toBe('NO_SOURCE_CHAPTERS');
    expect(await code('chapters_adopt', { video: plain.videoId, outline: 'no timestamps here' })).toBe('NO_SOURCE_CHAPTERS');

    const loose = await talkVideo({ provenance: { origin: 'link-import', source }, place: false });
    const revision = video(loose.videoId).revision;
    expect(await code('chapters_adopt', { video: loose.videoId })).toBe('ASSET_NOT_PLACED');
    expect(await code('chapters_adopt', { video: loose.videoId, dryRun: true })).toBe('ASSET_NOT_PLACED');
    expect(video(loose.videoId).revision).toBe(revision);
  });
});
