import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { editorWasmAvailable } from '@baocut/jobs';
import { newId, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { TOOL_RISK } from './tool-scope.ts';
import { ToolDriver, tool, until, type ToolSession } from './testing/fake-agent.ts';

/**
 * 智能体写作的出处（创作辅助集成设计 §3.4「智能体路径」）端到端：假智能体经真实的 MCP 端点用 `speech_sentences` 取编了号的句子，
 * 写成带 `[sN]` 的 Markdown，再用 `downloads_save` 交出；交出的是去掉编号的正文，出处随 Space 条目保存。
 * 需要 engine-host、ffmpeg 与 editor-wasm（句子规则），缺了就跳过。
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
const ready = !!engine && ffmpeg && editorWasmAvailable();
if (!ready) console.warn('跳过按句编号工具测试：没有 engine-host、ffmpeg 或 editor-wasm');

describe.skipIf(!ready)('按句编号读讲话与带出处的交付（真实引擎）', () => {
  let fixtures: string;
  let audio: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let project: Project;
  let conversationId: Id;
  let videoId: Id;
  let videoPath: string;
  let speechId: Id;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-speech-sentences-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-speech-sentences-'));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    await client.request('settings.set', { values: { 'downloads.directory': path.join(dir, 'Downloads') } });
    ({ project } = await client.request('projects.create', { name: '写作出处' }));
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
    const opened = await client.request('videos.create', { projectId: project.id, name: '样片' });
    videoId = opened.ref.videoId;
    videoPath = opened.ref.relPath;
    const words = [
      { id: 'w1', start: 0, end: 500, text: 'Hello' },
      { id: 'w2', start: 500, end: 1000, text: 'there.' },
      { id: 'w3', start: 1600, end: 2000, text: 'Good' },
      { id: 'w4', start: 2000, end: 2500, text: 'morning.' },
    ];
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: audio, ref: 'a' },
        { type: 'addItem', sequenceId: opened.snapshot.video.rootSequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
        {
          type: 'putDocument',
          kind: 'speech',
          language: 'en',
          sourceAsset: { ref: 'a' },
          body: { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1000, speakers: [], words, sentences: null, chapters: [] },
        },
      ],
    });
    speechId = Object.values(runtime.videos.mirror(videoId)!.video.documents).find((d) => d.kind === 'speech')!.id;
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function send(): Promise<ToolSession> {
    await client.request('conversations.send', { conversationId, text: '写一篇总结', commandId: newId('cmd'), autonomy: 'auto' });
    const session = await until(() => driver.sessions.find((s) => s.turnId));
    await until(() => runtime.harness.agentRun(conversationId).taskId);
    return session;
  }

  it('重录与术语候选：没装模型时按字面找说了两遍的同一句；没有术语表时只有发现', async () => {
    expect(TOOL_RISK.speech_retakes).toBe('read');
    expect(TOOL_RISK.speech_glossary_candidates).toBe('read');
    const session = await send();
    // 换成说了两遍的同一句（同一份素材上的新转写）。
    const video = runtime.videos.mirror(videoId)!.video;
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: video.revision,
      operations: [
        {
          type: 'putDocument',
          documentId: speechId,
          kind: 'speech',
          language: 'en',
          sourceAsset: { assetId: Object.keys(video.assets)[0]! },
          body: {
            schema: 'baocut.speech/1',
            clock: 'source-asset',
            timescale: 1000,
            speakers: [],
            words: [
              { id: 'r1', start: 0, end: 400, text: 'We' },
              { id: 'r2', start: 400, end: 800, text: 'ship' },
              { id: 'r3', start: 800, end: 1200, text: 'today.' },
              { id: 'r4', start: 1600, end: 2000, text: 'We' },
              { id: 'r5', start: 2000, end: 2400, text: 'ship' },
              { id: 'r6', start: 2400, end: 2800, text: 'today.' },
            ],
            sentences: null,
            chapters: [],
          },
        },
      ],
    });
    const retakes = await tool(session, 'speech_retakes', { video: videoPath });
    expect(retakes.isError).toBe(false);
    expect(retakes.body).toMatchObject({ videoId, documentId: speechId, effectiveMode: 'lexical' });
    expect(retakes.body.groups).toHaveLength(1);
    expect(retakes.body.groups[0].takes.map((t: { text: string; wordIds: string[] }) => [t.text, t.wordIds])).toEqual([
      ['We ship today.', ['r1', 'r2', 'r3']],
      ['We ship today.', ['r4', 'r5', 'r6']],
    ]);
    const terms = await tool(session, 'speech_glossary_candidates', { video: videoPath });
    expect(terms.body).toMatchObject({ videoId, glossaries: 0, candidates: [] });
    // 话题转折：没有语义模型（或文稿太短）时没有候选，交回给智能体自己判断。
    expect(TOOL_RISK.speech_topic_boundaries).toBe('read');
    const topics = await tool(session, 'speech_topic_boundaries', { video: videoPath });
    expect(topics.isError).toBe(false);
    expect(topics.body).toMatchObject({ videoId, documentId: speechId, mode: 'model', calibrated: false, candidates: [] });
  });

  it('句子按时间线编号、再取时编号不变；带编号的 Markdown 交出时去掉编号，出处随 Space 条目保存', async () => {
    expect(TOOL_RISK.speech_sentences).toBe('read');
    const session = await send();
    const first = await tool(session, 'speech_sentences', { video: videoPath });
    expect(first.isError).toBe(false);
    expect(first.body).toMatchObject({ videoId, documentId: speechId });
    expect(first.body.sentences.map((s: { ref: string; text: string }) => [s.ref, s.text])).toEqual([
      ['s1', 'Hello there.'],
      ['s2', 'Good morning.'],
    ]);
    expect(first.body.text).toBe('[s1] [00:00] Hello there.\n[s2] [00:01] Good morning.');
    const again = await tool(session, 'speech_sentences', { video: videoPath, range: '1.5:3' });
    expect(again.body.sentences.map((s: { ref: string }) => s.ref)).toEqual(['s2']);

    await fs.writeFile(path.join(project.path, 'summary.md'), '# Greetings\n\nThey say hello [s1] and good morning [s2].\n\nUnfounded claim [s7].\n');
    const saved = await tool(session, 'downloads_save', { path: 'summary.md' });
    expect(saved.isError).toBe(false);
    expect(saved.body.citations).toEqual({ cited: 1, inferred: 1, dropped: 1, saved: true });
    expect(await fs.readFile(saved.body.path, 'utf8')).toBe('# Greetings\n\nThey say hello and good morning.\n\nUnfounded claim.\n');

    const entry = await until(() => runtime.space?.entries().find((e) => e.file?.path === saved.body.path && e.citations));
    expect(entry.kind).toBe('document');
    const located = await runtime.models.jobs.artifacts.read(entry.citations!.artifactId);
    const citations = JSON.parse(located!.toString('utf8'));
    expect(citations.paragraphs[1].cites).toEqual([
      { videoId, documentId: speechId, sentenceIds: [expect.stringMatching(/^s-/), expect.stringMatching(/^s-/)], clock: 'sequence', startSec: 0, endSec: 2.5, text: 'Hello there. Good morning.' },
    ]);
  });
});
