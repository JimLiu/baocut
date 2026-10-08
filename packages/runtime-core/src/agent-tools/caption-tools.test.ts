import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { editorWasmAvailable } from '@baocut/jobs';
import { newId, type AgentMode, type CaptionItem, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { TOOL_RISK } from './tool-scope.ts';
import { ToolDriver, tool, until, type Loose, type ToolSession } from './testing/fake-agent.ts';

/**
 * `captions_create` 端到端（架构设计 §7.9「给智能体建字幕层的操作」）：假智能体经真实的 MCP 端点给转写与自己写的译文
 * 建字幕层，落到真实的引擎里。原文、译文、双语与重复建（不覆盖）；规划模式只读。译文的句子经 editor-wasm 派生。
 * 需要 engine-host、ffmpeg 与 editor-wasm，缺了就跳过。
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
if (!ready) console.warn('跳过建字幕层工具测试：没有 engine-host、ffmpeg 或 editor-wasm');

describe.skipIf(!ready)('建字幕层工具（真实引擎）', () => {
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
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-caption-tools-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-caption-tools-'));
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
    ({ project } = await client.request('projects.create', { name: '字幕工具' }));
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

  async function send(mode: AgentMode): Promise<ToolSession> {
    await client.request('conversations.send', { conversationId, text: '加字幕', commandId: newId('cmd'), autonomy: mode });
    const session = await until(() => driver.sessions.find((s) => s.turnId));
    await until(() => runtime.harness.agentRun(conversationId).taskId);
    return session;
  }

  const video = () => runtime.videos.mirror(videoId)!.video;
  const captionItems = (documentId: Id) =>
    video().sequences[video().rootSequenceId]!.items.filter((i): i is CaptionItem => i.type === 'caption' && i.documentId === documentId);

  /** 照 documents_read 的写法写一份译文：alignment 写 null，由 Runtime 补。 */
  async function writeTranslation(session: ToolSession): Promise<{ translationId: Id; put: Loose }> {
    const read = await tool(session, 'documents_read', { video: videoPath, documentId: speechId });
    const basis = read.body.translationBasis;
    const inspected = await tool(session, 'videos_inspect', { video: videoPath });
    const texts = ['你好。', '早上好。'];
    const put = await tool(session, 'edits_apply', {
      video: videoPath,
      expectedRevision: inspected.body.revision,
      label: '写入中文译文',
      operations: [
        {
          type: 'putDocument',
          kind: 'translation',
          language: 'zh-Hans',
          sourceDocument: { documentId: speechId },
          body: {
            schema: 'baocut.translation/2',
            language: 'zh-Hans',
            sourceBasis: basis.sourceBasis,
            units: basis.sentences.map((s: Loose, i: number) => ({
              id: `t-${s.id}`,
              sourceSentenceId: s.id,
              sourceFingerprint: s.fingerprint,
              naturalText: texts[i],
              alignment: null,
              status: 'draft',
            })),
          },
        },
      ],
    });
    expect(put.isError).toBe(false);
    const translationId = Object.values(video().documents).find((d) => d.kind === 'translation')!.id;
    return { translationId, put: put.body };
  }

  it('风险与 edits_apply 相同；规划模式下拒绝，视频不变', async () => {
    expect(TOOL_RISK.captions_create).toBe(TOOL_RISK.edits_apply);
    const session = await send('plan');
    const before = video().revision;
    const refused = await tool(session, 'captions_create', { video: videoPath, documentId: speechId });
    expect(refused.body.error.code).toBe('PLAN_ONLY');
    expect(video().revision).toBe(before);
  });

  it('转写建原文字幕；智能体写的译文补上对齐后建译文与双语字幕；再建一次不覆盖', async () => {
    const session = await send('auto');

    // 原文：放进新建的字幕轨，显示着。
    const original = await tool(session, 'captions_create', { video: videoPath, documentId: speechId });
    expect(original.isError).toBe(false);
    expect(original.body).toMatchObject({
      transactionId: expect.any(String),
      revision: { before: expect.any(String), after: video().revision },
      documentId: expect.any(String),
      trackId: expect.any(String),
      itemIds: [expect.any(String)],
      cueCount: 2,
      enabled: true,
      layoutProfileId: 'default',
      existing: null,
      approval: { risk: 'edit', decidedBy: 'auto' },
    });
    const originalDoc = original.body.documentId as Id;
    expect(video().documents[originalDoc]).toMatchObject({ kind: 'caption', sourceDocumentId: speechId });
    expect(captionItems(originalDoc).map((i) => [i.id, i.trackId, i.enabled])).toEqual([
      [original.body.itemIds[0], original.body.trackId, true],
    ]);
    expect(video().sequences[video().rootSequenceId]!.tracks.find((t) => t.id === original.body.trackId)?.kind).toBe('subtitle');

    const bilingualSpeech = await tool(session, 'captions_create', { video: videoPath, documentId: speechId, bilingual: true });
    expect(bilingualSpeech.body.error.code).toBe('INVALID_ARGUMENTS');

    // 译文：alignment 为 null 的两句由 Runtime 按句子补成句级对齐。
    const { translationId, put } = await writeTranslation(session);
    expect(put.filledAlignments).toBe(2);
    const translation = await tool(session, 'documents_read', { video: videoPath, documentId: translationId });
    expect(translation.body.body.units.map((u: Loose) => u.alignment)).toEqual([
      expect.objectContaining({
        correspondence: 'sentence',
        blocks: [],
        sourceWordIds: ['w1', 'w2'],
        textHash: expect.stringMatching(/^sha256:/),
      }),
      expect.objectContaining({
        correspondence: 'sentence',
        blocks: [],
        sourceWordIds: ['w3', 'w4'],
        textHash: expect.stringMatching(/^sha256:/),
      }),
    ]);

    // 双语：译文一层（新轨），与原文共用新建的样式，原文留在画面上。
    const bilingual = await tool(session, 'captions_create', { video: videoPath, documentId: translationId, bilingual: true });
    expect(bilingual.isError).toBe(false);
    expect(bilingual.body).toMatchObject({
      cueCount: 2,
      enabled: true,
      bilingual: true,
      existing: null,
      pairedOriginal: { documentId: originalDoc, itemIds: original.body.itemIds },
    });
    expect(bilingual.body.trackId).not.toBe(original.body.trackId);
    const translated = captionItems(bilingual.body.documentId);
    expect(translated.map((i) => i.trackId)).toEqual([bilingual.body.trackId]);
    expect(video().documents[bilingual.body.documentId]).toMatchObject({
      kind: 'caption',
      language: 'zh-Hans',
      sourceDocumentId: translationId,
    });
    const cues = (await tool(session, 'documents_read', { video: videoPath, documentId: bilingual.body.documentId })).body.body.cues;
    expect(cues.map((c: Loose) => [c.text, c.start, c.end])).toEqual([
      ['你好。', 0, 1000],
      ['早上好。', 1600, 2500],
    ]);
    const style = translated[0]!.styleDocumentId;
    expect(style).toEqual(expect.any(String));
    expect(captionItems(originalDoc).map((i) => [i.enabled, i.styleDocumentId])).toEqual([[true, style]]);

    // 同一份译文再建一次（只看译文）：不覆盖，新的一层停用着放上去，配对的原文不动。
    const again = await tool(session, 'captions_create', { video: videoPath, documentId: translationId });
    expect(again.isError).toBe(false);
    expect(again.body).toMatchObject({
      enabled: false,
      bilingual: false,
      existing: { documentId: bilingual.body.documentId, itemIds: translated.map((i) => i.id) },
      note: expect.stringContaining('没有覆盖'),
    });
    expect(again.body.documentId).not.toBe(bilingual.body.documentId);
    expect(captionItems(again.body.documentId).map((i) => i.enabled)).toEqual([false]);
    expect(captionItems(originalDoc).map((i) => i.enabled)).toEqual([true]);
    expect(captionItems(bilingual.body.documentId).map((i) => i.enabled)).toEqual([true]);

    // 转写再建一次：同样另建一层、停用着。
    const twice = await tool(session, 'captions_create', { video: videoPath, documentId: speechId, layoutProfileId: 'two-line' });
    expect(twice.body).toMatchObject({ enabled: false, layoutProfileId: 'two-line', existing: { documentId: originalDoc } });

    // 每一次都是一笔修改：会话里放了变更卡。
    const cards = (await client.request('conversations.get', { conversationId })).items.filter((i) => i.kind === 'video-change');
    expect(cards.filter((c) => (c as Loose).label === '建立字幕层')).toHaveLength(4);
  });

  it('没有原文字幕层时给译文带 bilingual: true：一次调用两层都建、共用样式，pairedOriginal 标 created；撤销一笔两层一起撤', async () => {
    const session = await send('auto');
    const { translationId } = await writeTranslation(session);
    const before = video().revision;
    const bilingual = await tool(session, 'captions_create', { video: videoPath, documentId: translationId, bilingual: true });
    expect(bilingual.isError).toBe(false);
    expect(bilingual.body).toMatchObject({
      transactionId: expect.any(String),
      revision: { before, after: video().revision },
      documentId: expect.any(String),
      trackId: expect.any(String),
      itemIds: [expect.any(String)],
      cueCount: 2,
      enabled: true,
      bilingual: true,
      existing: null,
      pairedOriginal: { documentId: expect.any(String), itemIds: [expect.any(String)], created: true },
    });
    expect(bilingual.body).not.toHaveProperty('bilingualNote');
    const { documentId: translatedDoc, pairedOriginal } = bilingual.body;
    expect(pairedOriginal.documentId).not.toBe(translatedDoc);
    expect(video().documents[pairedOriginal.documentId]).toMatchObject({ kind: 'caption', sourceDocumentId: speechId });
    expect(video().documents[translatedDoc]).toMatchObject({ kind: 'caption', sourceDocumentId: translationId, language: 'zh-Hans' });
    const original = captionItems(pairedOriginal.documentId);
    const translated = captionItems(translatedDoc);
    expect(original.map((i) => i.id)).toEqual(pairedOriginal.itemIds);
    expect(translated.map((i) => i.id)).toEqual(bilingual.body.itemIds);
    expect(translated.map((i) => i.trackId)).toEqual([bilingual.body.trackId]);
    expect(original[0]!.trackId).not.toBe(translated[0]!.trackId);
    const style = translated[0]!.styleDocumentId;
    expect(style).toEqual(expect.any(String));
    expect(original.map((i) => [i.enabled, i.styleDocumentId])).toEqual([[true, style]]);
    expect(translated.map((i) => i.enabled)).toEqual([true]);
    const cues = (await tool(session, 'documents_read', { video: videoPath, documentId: pairedOriginal.documentId })).body.body.cues;
    expect(cues.map((c: Loose) => c.text)).toEqual(['Hello there.', 'Good morning.']);

    // 一笔事务：撤销它，原文与译文的字幕实例一起没了。
    const undone = await tool(session, 'edits_undo', { video: videoPath, transactionId: bilingual.body.transactionId });
    expect(undone.isError).toBe(false);
    expect(captionItems(pairedOriginal.documentId)).toEqual([]);
    expect(captionItems(translatedDoc)).toEqual([]);
    expect(video().sequences[video().rootSequenceId]!.items.filter((i) => i.type === 'caption')).toEqual([]);
  });

  it('不能建字幕层的文档与素材不在时间线上：明确的错误码，视频不变', async () => {
    const session = await send('auto');
    const inspected = await tool(session, 'videos_inspect', { video: videoPath });
    const missing = await tool(session, 'captions_create', { video: videoPath, documentId: 'doc_nope' });
    expect(missing.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    const itemId = video().sequences[video().rootSequenceId]!.items[0]!.id;
    const removed = await tool(session, 'edits_apply', {
      video: videoPath,
      expectedRevision: inspected.body.revision,
      label: '拿掉素材',
      operations: [{ type: 'deleteItems', itemIds: [itemId] }],
    });
    expect(removed.isError).toBe(false);
    const before = video().revision;
    const offline = await tool(session, 'captions_create', { video: videoPath, documentId: speechId });
    expect(offline.body.error).toMatchObject({ code: 'CAPTIONS_NOT_ON_TIMELINE', next: expect.any(String) });
    expect(video().revision).toBe(before);
  });
});
