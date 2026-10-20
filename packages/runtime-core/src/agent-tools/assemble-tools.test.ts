import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { resolveElectronBinary } from '@baocut/code-runtime';
import type { CatalogCallResult, Id, Project, SequenceItem } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveExportWorkerCommand } from '../exports/video-export.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { TOOL_RISK } from './tool-scope.ts';
import type { Loose } from './testing/fake-agent.ts';

/**
 * 一次放好制作计划（`edits_assemble`，Agent 面设计 §4.3）端到端：经终端的 `catalog.call` 先预演、再放好两段代码画面与旁白、
 * 一个实拍片段（带入点、音量与转场）和一张卡片；原样重跑什么都不改；第一段变长、中间插进一段、卡片换了时刻时只动变了的，
 * 后面的内容跟着挪；从计划里删掉已放好的段落时拒绝。需要 engine-host、Render Worker、ffmpeg 与 Electron，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const worker = resolveExportWorkerCommand(engine);
const electron = resolveElectronBinary();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** 最小的 HyperFrames 合成：`seconds` 秒长，画面只由 seek 到的时间决定。 */
function bundleHtml(seconds: number, alpha: boolean): string {
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div id="root" data-composition-id="main" data-width="320" data-height="180" data-fps="30" data-duration="${seconds}" data-alpha="${alpha}">
<div id="t" style="position:absolute;left:20px;top:20px;width:80px;height:40px;background:#3a6"></div></div>
<script>var el=document.getElementById('t');var t=0;function r(){el.style.opacity=String(0.2+Math.min(0.8,t/2));}
window.__timelines={main:{seek:function(s){t=Math.min(Math.max(Number(s)||0,0),${seconds});r();},time:function(){return t;},duration:function(){return ${seconds};},pause:function(){},play:function(){},timeScale:function(){return 1;}}};r();</script>
</body></html>`;
}

describe.skipIf(!engine || !worker || !ffmpeg || !electron)('制作计划（终端目录，真实引擎与 Electron）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let videoId: Id;

  const write = async (rel: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(project.path, rel)), { recursive: true });
    await fs.writeFile(path.join(project.path, rel), content);
  };

  beforeAll(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-assemble-tools-')));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({ resolve: async () => ({ endpoint, token }), client: { kind: 'cli', name: 'test', version: '0' }, reconnect: false });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: 'assemble' }));
    await write('scenes/s1/index.html', bundleHtml(2, false));
    await write('scenes/s2/index.html', bundleHtml(3, false));
    await write('scenes/s3/index.html', bundleHtml(1.5, false));
    await write('cards/k1/index.html', bundleHtml(1, true));
    await write('timing/s1.json', JSON.stringify({ lines: [{ text: 'hello', start: 0.1 }, { text: 'second line', start: 1, chars: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.95] }] }));
    await fs.mkdir(path.join(project.path, 'media'));
    const run = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.8', path.join(project.path, 'media', 's1.wav')]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=2.7', path.join(project.path, 'media', 's2.wav')]);
    run([
      ...['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=5'],
      ...['-shortest', '-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'aac', path.join(project.path, 'media', 'clip.mp4')],
    ]);
  }, 120_000);

  afterAll(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000); // 关 Runtime 要等烘焙任务收尾

  async function call(name: string, args: unknown): Promise<CatalogCallResult> {
    return client.request('catalog.call', { name, args, cwd: project.path });
  }

  async function ok(name: string, args: unknown): Promise<Loose> {
    const outcome = await call(name, args);
    if (!outcome.ok) throw new Error(`${name} 失败：${JSON.stringify(outcome.error)}`);
    return outcome.result;
  }

  const items = () => {
    const video = runtime.videos.mirror(videoId)!.video;
    return video.sequences[video.rootSequenceId]!.items;
  };
  const byName = (name: string) => items().find((i) => i.name === name) as SequenceItem & Loose;
  const start = (item: Loose) => (item.span ? item.span.fromFrame : item.fromFrame) as number;

  const plan = (over: Loose = {}) => ({
    segments: [
      { id: 's1', bundle: 'scenes/s1', narration: { path: 'media/s1.wav' }, timing: 'timing/s1.json' },
      { id: 's2', bundle: 'scenes/s2', narration: { path: 'media/s2.wav' } },
    ],
    clips: [{ id: 'c1', seg: 's1', line: 1, cue: 'line', path: 'media/clip.mp4', from: 2, to: 2.5, audio: 0.5, in: { kind: 'dissolve', dur: 0.2 } }],
    cards: [{ id: 'k1', seg: 's2', at: 0.2, bundle: 'cards/k1' }],
    ...over,
  });

  it('预演不改视频；放好之后各段首尾相接，旁白在段首，实拍按字放，卡片在卡片轨', async () => {
    expect(TOOL_RISK.edits_assemble).toBe(TOOL_RISK.edits_apply);
    const created = await ok('videos_create', { name: 'assemble', width: 320, height: 180, fps: 30 });
    videoId = created.videoId;

    const dry = await ok('edits_assemble', { video: videoId, plan: plan(), dryRun: true });
    expect(dry.revision).toEqual({ before: created.revision, after: created.revision });
    expect(dry.segments.map((s: Loose) => [s.id, s.from, s.frames, s.action])).toEqual([
      ['s1', 0, 60, 'place'],
      ['s2', 60, 90, 'place'],
    ]);
    // "line" 是第 1 句的第 7 个字：1.7 秒 → 第 51 帧，长 0.5 秒；截在第一段的末尾（60）。
    expect(dry.clips.map((c: Loose) => [c.id, c.from, c.frames])).toEqual([['c1', 51, 9]]);
    expect(dry.cards.map((c: Loose) => [c.id, c.from, c.frames])).toEqual([['k1', 66, 30]]);
    expect(items()).toHaveLength(0);

    const done = await ok('edits_assemble', { video: videoId, plan: plan(), background: false });
    expect(done.check).toEqual({ ok: true, problems: [] });
    expect(done.recordDocumentId).toEqual(expect.any(String));
    expect(start(byName('s1'))).toBe(0);
    expect(byName('s1').span.durationFrames).toBe(60);
    expect(start(byName('s2'))).toBe(60);
    expect(start(byName('s1 narration'))).toBe(0);
    expect(start(byName('s2 narration'))).toBe(60);
    expect(byName('c1')).toMatchObject({
      type: 'video',
      role: 'broll',
      span: { fromFrame: 51, durationFrames: 9 },
      embeddedAudio: { enabled: true, volume: 0.5 },
    });
    expect(Number(byName('c1').timeMap.sourceIn.ticks) / byName('c1').timeMap.sourceIn.timescale).toBe(2);
    expect(start(byName('k1'))).toBe(66);
    const video = runtime.videos.mirror(videoId)!.video;
    const sequence = video.sequences[video.rootSequenceId]!;
    expect(sequence.transitions).toEqual([expect.objectContaining({ kind: 'dissolve', rightItemId: byName('c1').id })]);
    const tracks = new Map(sequence.tracks.map((t) => [t.id, t]));
    expect(tracks.get(byName('s1').trackId)!.name).toBe('Scenes');
    expect(tracks.get(byName('c1').trackId)!.order).toBeGreaterThan(tracks.get(byName('s1').trackId)!.order);
    expect(tracks.get(byName('k1').trackId)!.order).toBeGreaterThan(tracks.get(byName('c1').trackId)!.order);
    expect(video.documents[done.recordDocumentId]!.kind).toBe('production-plan');
    // 记录里没有本机路径，便携包照常能带出去。
    expect(JSON.stringify(video.documents[done.recordDocumentId])).not.toContain(project.path);

    const again = await ok('edits_assemble', { video: videoId, plan: plan(), background: false });
    expect(again.revision.after).toBe(again.revision.before);
  }, 300_000);

  it('第一段变长、中间插进一段、卡片换了时刻：只动变了的，后面的内容跟着挪；删掉已放好的段落时拒绝', async () => {
    const kept = { s2: byName('s2').id, c1: byName('c1').id, k1: byName('k1').id };
    await write('scenes/s1/index.html', bundleHtml(2.5, false));
    const changed = plan({
      segments: [plan().segments[0], { id: 's3', bundle: 'scenes/s3' }, plan().segments[1]],
      cards: [{ id: 'k1', seg: 's2', at: 0.5, bundle: 'cards/k1' }],
    });
    const done = await ok('edits_assemble', { video: videoId, plan: changed, background: false });
    expect(done.steps).toEqual([
      { kind: 'insert', id: 's3', boundary: 60, delta: 45 },
      { kind: 'resize', id: 's1', boundary: 60, delta: 15 },
    ]);
    expect(done.segments.map((s: Loose) => [s.id, s.from, s.frames, s.action])).toEqual([
      ['s1', 0, 75, 'resize'],
      ['s3', 75, 45, 'place'],
      ['s2', 120, 90, 'keep'],
    ]);
    expect(done.check.ok).toBe(true);
    expect(byName('s2').id).toBe(kept.s2);
    expect(start(byName('s2'))).toBe(120);
    expect(start(byName('s2 narration'))).toBe(120);
    expect(start(byName('s3'))).toBe(75);
    // 第一段变长之后 c1 不再被段尾截短：长度变了，重新放。
    expect(done.clips.map((c: Loose) => [c.id, c.from, c.frames, c.action])).toEqual([['c1', 51, 15, 'place']]);
    expect(byName('c1').id).not.toBe(kept.c1);
    expect(byName('k1')).toMatchObject({ id: kept.k1, span: { fromFrame: 135 } });

    const removed = await call('edits_assemble', { video: videoId, plan: plan(), dryRun: true });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error).toMatchObject({ code: 'PLAN_SEGMENT_REMOVED' });
  }, 300_000);
});
