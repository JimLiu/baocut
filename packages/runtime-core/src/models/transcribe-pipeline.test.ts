import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { existingCaptionLayer, fakeSpeechAnswer, resolveSpeechWorkerCommand } from '@baocut/jobs';
import {
  chatCompletionReply,
  openAiTranscriptionReply,
  startFakeProviderServer,
  type FakeHandler,
  type FakeProviderServer,
} from '@baocut/providers/testing';
import {
  grantCreateParamsFor,
  newId,
  type CaptionItem,
  type GrantRequestItem,
  type Id,
  type JobRecord,
  type Project,
  type TranscribeSummary,
  type TranslateSummary,
  type VideoSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { until } from '../agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { pipelineTargets } from '../videos/pipeline-targets.ts';

/**
 * 转录流程与翻译的字幕层（架构设计 §7.9）经网关端到端，真实引擎，假的在线转写与文本模型（本机回环地址上的假 OpenAI）：
 *
 * - `target.create.media`：本地生成的小音频 → 项目里新建一个视频，素材放上时间线，一份文稿、一层字幕；Space 记下来源。
 * - `entryId` 指向没打开的视频、这份素材已有转写：缺省在同一项目新建一部视频（链接同一份素材），原视频不动。
 * - `destination: 'replace'`：一笔事务换成文稿的新版本，译文结转、字幕重切；撤销那笔事务回到旧文稿；文稿被改过时拒绝。
 * - 翻译（真的 Speech Worker）：`captions: true` 时建，字幕条是 Worker 切好的；只显示译文（配对的原文字幕层拿下），
 *   撤销那笔事务时字幕层没了、译文还在；双语时共用样式、原文放回来；流程参数默认不建。
 *
 * 密钥是测试里编的字符串。没有 engine-host、speech-worker、ffmpeg 时跳过。
 */

const engine = resolveEngineHostCommand();
const speechWorker = resolveSpeechWorkerCommand(engine);
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine) console.warn('跳过转录流程的端到端测试：没有构建 engine-host（npm run build:engine）');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-transcribe-0123456789';

/** 假 OpenAI：转写回「hello world.」，翻译按 Speech Worker 的请求答（`fakeSpeechAnswer`）。 */
function fakeOpenAi(): FakeHandler {
  return (request) => {
    if (request.method === 'GET' && request.path.endsWith('/models')) return { status: 200, json: { object: 'list', data: [] } };
    if (request.method === 'POST' && request.path.endsWith('/audio/transcriptions'))
      return openAiTranscriptionReply(request, 'hello world.');
    if (request.method === 'POST' && request.path.endsWith('/chat/completions')) {
      const messages = (request.json as { messages: Array<{ role: string; content: string }> }).messages;
      const user = messages.find((m) => m.role === 'user')!.content;
      return chatCompletionReply(
        request,
        fakeSpeechAnswer(user, () => '你好世界'),
      );
    }
    return { status: 404, json: { error: { message: 'not found' } } };
  };
}

describe.skipIf(!engine || !speechWorker || !hasFfmpeg)('转录流程与字幕层（真实引擎）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let openai: FakeProviderServer;
  let media: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-transcribe-pipeline-'));
    media = path.join(dir, 'media', '采访 片段.wav');
    await fs.mkdir(path.dirname(media));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '16000', '-ac', '1', media]);
    openai = await startFakeProviderServer(fakeOpenAi());
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      jobIdleMs: 60_000,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '转录' }));
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' });
    await client.request('models.setDefault', { capability: 'generateText', providerId: 'openai' });
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await openai.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function settled(jobId: string): Promise<JobRecord> {
    await runtime.models.jobs.settled(jobId);
    await runtime.models.pipelines.idle();
    return runtime.models.jobs.inspect(jobId);
  }

  const start = (pipeline: string, params: Record<string, unknown>) => client.request('pipelines.start', { pipeline, params });

  /** 打开视频（已经开着时接上），读快照。 */
  async function snapshot(videoId: Id, relPath: string): Promise<VideoSnapshot> {
    const opened = await client.request('videos.open', { projectId: project.id, path: relPath });
    expect(opened.ref.videoId).toBe(videoId);
    return opened.snapshot.video;
  }

  const captions = (video: VideoSnapshot) =>
    video.sequences[video.rootSequenceId]!.items.filter((item): item is CaptionItem => item.type === 'caption');

  it('从本机媒体新建视频：导入、放上时间线、转写、建字幕层；再转写另建视频；翻译建目标语言字幕层；取代文稿结转译文', async () => {
    // 1. 新建视频。
    const created = await start('transcribe', { target: { create: { projectId: project.id, media } } });
    const first = await settled(created.jobId);
    expect(first).toMatchObject({ state: 'completed', providerId: 'openai', pipeline: { stoppedAt: null } });
    expect(first.pipeline!.steps.map((s) => [s.name, s.status])).toEqual([
      ['target', 'skipped'],
      ['create', 'completed'],
      ['transcribe', 'completed'],
      ['captions', 'completed'],
    ]);
    const summary = first.pipeline!.summary as unknown as TranscribeSummary;
    expect(summary).toMatchObject({
      createdVideo: true,
      target: 'first',
      providerId: 'openai',
      captions: { status: 'created', enabled: true, cueCount: 1 },
    });
    const videoId = summary.videoId;
    // 转写是流程提交的一个 transcribe Job。
    expect(runtime.models.jobs.inspect(summary.transcribeJobId)).toMatchObject({
      kind: 'transcribe',
      state: 'completed',
      submitter: { kind: 'pipeline', id: created.jobId },
    });
    await until(() => runtime.videos.ref(videoId) === null);
    const dirs = (await fs.readdir(project.path)).filter((n) => !n.startsWith('.'));
    expect(dirs).toEqual(['采访 片段']);

    let video = await snapshot(videoId, '采访 片段');
    const asset = video.assets[summary.assetId]!;
    expect(asset.revisions[asset.currentRevision]).toMatchObject({ storage: { mode: 'linked', locator: { path: media } } });
    expect(JSON.stringify(asset)).toContain('file-import');
    const root = video.sequences[video.rootSequenceId]!;
    expect(root.items.find((i) => i.type === 'audio')).toMatchObject({ assetRef: { id: summary.assetId }, fromFrame: 0 });
    const speech = video.documents[summary.documentId]!;
    expect(speech).toMatchObject({ kind: 'speech', sourceAssetId: summary.assetId });
    const [layer] = captions(video);
    expect(layer).toMatchObject({ documentId: summary.captions.documentId, enabled: true });
    const captionDoc = video.documents[layer!.documentId]!;
    expect(captionDoc).toMatchObject({ kind: 'caption', sourceDocumentId: summary.documentId, sourceAssetId: summary.assetId });
    expect(captionDoc.extensions).toMatchObject({ pipeline: { name: 'transcribe', jobId: created.jobId, actor: 'system:pipeline' } });
    // 同一份文稿已经有字幕层：重跑这一步会跳过（`when` 用的同一个判断）。
    expect(existingCaptionLayer(root, video.documents, summary.documentId)).toMatchObject({ documentId: layer!.documentId });
    const history = await client.request('videos.history', { videoId });
    expect(history.entries[0]).toMatchObject({ actor: { kind: 'system', id: 'system:pipeline' } });
    // 摘要带着建字幕层的那笔事务（编辑器的「撤销」按它撤）。
    expect(history.entries.find((e) => e.transactionId === summary.captions.transactionId)).toMatchObject({
      label: '建立字幕层',
      actor: { kind: 'system', id: 'system:pipeline' },
      undoAvailable: true,
    });
    await client.request('videos.close', { videoId });
    await until(() => runtime.videos.ref(videoId) === null);

    // Space：视频条目的来源是这次运行。
    await client.request('space.rescan', {});
    await runtime.space.idle();
    const entry = (await client.request('space.list', { videoId, kind: 'video' })).entries[0]!;
    expect(entry.origin).toMatchObject({
      source: 'imported',
      projectId: project.id,
      videoId,
      jobId: created.jobId,
      capability: 'transcribe',
    });

    // 2. 按条目再转写（视频没打开）：这份素材已有文稿，缺省另建一部视频，链接同一份素材文件；原视频不动。
    const again = await start('transcribe', { target: { entryId: entry.id } });
    const second = await settled(again.jobId);
    expect(second.state, JSON.stringify(second.error)).toBe('completed');
    const secondSummary = second.pipeline!.summary as unknown as TranscribeSummary;
    expect(secondSummary).toMatchObject({
      createdVideo: true,
      target: 'new-video',
      replaced: null,
      captions: { status: 'created', enabled: true },
    });
    expect(secondSummary.videoId).not.toBe(videoId);
    expect(secondSummary.newVideo).toMatchObject({ videoId: secondSummary.videoId, name: expect.stringContaining('采访 片段') });
    await until(() => runtime.videos.ref(secondSummary.videoId) === null);
    expect((await fs.readdir(project.path)).filter((n) => !n.startsWith('.'))).toHaveLength(2);
    video = await snapshot(videoId, '采访 片段');
    expect(Object.values(video.documents).filter((d) => d.kind === 'speech')).toHaveLength(1);
    expect(captions(video)).toHaveLength(1);

    // 3. 翻译第一份文稿：默认只显示译文，配对的原文字幕层拿下（不删）。
    const translated = await settled(
      (await start('translate', { videoId, documentId: summary.documentId, targetLanguage: 'zh-Hans', captions: true })).jobId,
    );
    expect(translated).toMatchObject({ state: 'completed' });
    expect(translated.pipeline!.steps.at(-1)).toMatchObject({ name: 'captions', status: 'completed' });
    const tr = translated.pipeline!.summary as unknown as TranslateSummary;
    expect(tr.captions).toMatchObject({ status: 'created', enabled: true, bilingual: false });
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    const afterTranslate = captions(video);
    const trLayer = afterTranslate.find((c) => video.documents[c.documentId]!.sourceDocumentId === tr.documentId)!;
    expect(trLayer.enabled).toBe(true);
    expect(video.documents[trLayer.documentId]).toMatchObject({ kind: 'caption', language: 'zh-Hans' });
    expect(afterTranslate.find((c) => c.id === layer!.id)!.enabled).toBe(false);
    const trTrack = video.sequences[video.rootSequenceId]!.tracks.find((t) => t.id === trLayer.trackId)!;
    expect(trTrack).toMatchObject({ kind: 'subtitle' });
    // 字幕条是 Speech Worker 切好的：转写的刻度，ID 是 q-<译文单元>。
    const trCaption = await client.request('documents.read', { videoId, documentId: trLayer.documentId });
    const trBody = trCaption.body as { timescale: number; cues: Array<{ id: string; text: string; start: number; end: number }> };
    const speechBody = (await client.request('documents.read', { videoId, documentId: summary.documentId })).body as { timescale: number };
    expect(trBody.timescale).toBe(speechBody.timescale);
    expect(trBody.cues.length).toBeGreaterThan(0);
    expect(trBody.cues.every((cue) => cue.id.startsWith('q-t-s-') && cue.text === '你好世界' && Number.isInteger(cue.start))).toBe(true);

    // 撤销建字幕层的那笔事务：字幕层没了、配对的原文字幕层放回来，译文文档还在。
    const trHistory = await client.request('videos.history', { videoId });
    expect(trHistory.entries.find((e) => e.transactionId === tr.captions!.transactionId)).toMatchObject({
      label: '建立字幕层',
      actor: { kind: 'system', id: 'system:pipeline' },
      undoAvailable: true,
    });
    await client.request('edits.undo', { videoId, commandId: newId('cmd'), target: { transaction: tr.captions!.transactionId! } });
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    expect(captions(video).some((c) => c.documentId === trLayer.documentId)).toBe(false);
    expect(captions(video).find((c) => c.id === layer!.id)!.enabled).toBe(true);
    expect(video.documents[tr.documentId]).toMatchObject({ kind: 'translation' });

    // 4. 双语：新的译文层与原文共用一份样式，原文放回来。
    const bilingual = await settled(
      (await start('translate', { videoId, documentId: summary.documentId, targetLanguage: 'zh-Hans', captions: true, bilingual: true }))
        .jobId,
    );
    const bi = bilingual.pipeline!.summary as unknown as TranslateSummary;
    expect(bi.captions).toMatchObject({ status: 'created', bilingual: true });
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    const original = captions(video).find((c) => c.id === layer!.id)!;
    const biLayer = captions(video).find((c) => video.documents[c.documentId]!.sourceDocumentId === bi.documentId)!;
    expect(original.enabled).toBe(true);
    expect(original.styleDocumentId).toBeDefined();
    expect(biLayer.styleDocumentId).toBe(original.styleDocumentId);

    // 5. 不给 captions（流程参数默认）：只写译文，不建字幕层。
    const before = captions(video).length;
    const plain = await settled((await start('translate', { videoId, documentId: summary.documentId, targetLanguage: 'zh-Hans' })).jobId);
    expect(plain.pipeline!.steps.at(-1)).toMatchObject({ name: 'captions', status: 'skipped' });
    expect((plain.pipeline!.summary as unknown as TranslateSummary).captions).toMatchObject({ status: 'disabled' });
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    expect(captions(video)).toHaveLength(before);

    // 6. 取代当前文稿：一笔事务写同一份文稿的新版本，三份译文结转（原文没变，状态保留），派生的字幕重切。
    const oldSpeech = (await client.request('documents.read', { videoId, documentId: summary.documentId })) as {
      revision: string;
      body: { words: Array<{ id: string }>; stages?: { asr?: string } };
    };
    expect(oldSpeech.body.stages?.asr).toMatch(/^\d+:/);
    const replaced = await settled((await start('transcribe', { videoId, destination: 'replace' })).jobId);
    expect(replaced.state, JSON.stringify(replaced.error)).toBe('completed');
    const rs = replaced.pipeline!.summary as unknown as TranscribeSummary;
    expect(rs).toMatchObject({
      videoId,
      createdVideo: false,
      documentId: summary.documentId,
      target: 'replace',
      newVideo: null,
      replaced: { documentId: summary.documentId, previousVersion: oldSpeech.revision },
      captionPins: { reanchored: 0, orphaned: 0 },
      dubs: [],
    });
    expect(rs.replaced!.transactionId).toEqual(expect.any(String));
    const translationIds = Object.values(video.documents)
      .filter((d) => d.kind === 'translation')
      .map((d) => d.id)
      .sort();
    expect(rs.translations.map((t) => t.documentId).sort()).toEqual(translationIds);
    expect(rs.translations.every((t) => t.kept === 1 && t.stale === 0 && t.unmatched === 0)).toBe(true);
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    expect(Object.values(video.documents).filter((d) => d.kind === 'speech')).toHaveLength(1);
    const newSpeech = (await client.request('documents.read', { videoId, documentId: summary.documentId })) as typeof oldSpeech;
    expect(newSpeech.revision).not.toBe(oldSpeech.revision);
    expect(newSpeech.body.words.map((w) => w.id)).not.toEqual(oldSpeech.body.words.map((w) => w.id));
    for (const id of translationIds) {
      const tr = (await client.request('documents.read', { videoId, documentId: id })).body as {
        sourceBasis: { speechRef: { revision: string } };
        units: Array<{ sourceSentenceId: string; status: string }>;
      };
      expect(tr.sourceBasis.speechRef.revision).toBe(newSpeech.revision);
      expect(tr.units.map((u) => u.sourceSentenceId)).toEqual([`s-${newSpeech.body.words[0]!.id}`]);
    }
    const replacedHistory = await client.request('videos.history', { videoId });
    expect(replacedHistory.entries.find((e) => e.transactionId === rs.replaced!.transactionId)).toMatchObject({ undoAvailable: true });

    // 撤销那笔事务：文稿回到旧版本。
    await client.request('edits.undo', { videoId, commandId: newId('cmd'), target: { transaction: rs.replaced!.transactionId! } });
    const undone = (await client.request('documents.read', { videoId, documentId: summary.documentId })) as typeof oldSpeech;
    expect(undone.body.words.map((w) => w.id)).toEqual(oldSpeech.body.words.map((w) => w.id));

    // 7. 改过的文稿（全文指纹与 stages.asr 不再一致）：取代以 TRANSCRIPT_EDITED 拒绝，不建任务；acceptEdited 时照做。
    const editedBody = structuredClone(undone.body) as { words: Array<{ id: string; text: string }> };
    editedBody.words[0]!.text = 'Howdy';
    video = (await client.request('videos.open', { projectId: project.id, path: '采访 片段' })).snapshot.video;
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: video.revision,
      operations: [{ type: 'putDocument', documentId: summary.documentId, kind: 'speech', body: editedBody }],
    });
    const jobsBefore = (await client.request('jobs.list', { children: true })).jobs.length;
    const refused = (await start('transcribe', { videoId, destination: 'replace' }).catch((e: unknown) => e)) as {
      code: string;
      details: Record<string, unknown>;
    };
    expect(refused).toMatchObject({ code: 'conflict', details: { code: 'TRANSCRIPT_EDITED', documentId: summary.documentId } });
    expect((await client.request('jobs.list', { children: true })).jobs).toHaveLength(jobsBefore);
    const accepted = await settled((await start('transcribe', { videoId, destination: 'replace', acceptEdited: true })).jobId);
    expect(accepted.state, JSON.stringify(accepted.error)).toBe('completed');
    expect(accepted.pipeline!.summary).toMatchObject({ target: 'replace' });
    const afterAccept = (await client.request('documents.read', { videoId, documentId: summary.documentId })) as typeof oldSpeech;
    for (const id of translationIds) {
      const tr = (await client.request('documents.read', { videoId, documentId: id })).body as {
        sourceBasis: { speechRef: { revision: string } };
      };
      expect(tr.sourceBasis.speechRef.revision).toBe(afterAccept.revision);
    }
    await client.request('videos.close', { videoId });

    // 密钥不进任务记录。
    expect(JSON.stringify(await client.request('jobs.list', { children: true }))).not.toContain(OPENAI_KEY);
  });

  it('新建在「建好、还没记下」之间中断：按占下的位置再新建时认回那个视频，不多建', async () => {
    const targets = pipelineTargets(runtime.videos, {
      entry: () => {
        throw new Error('不按条目');
      },
      projectRoot: () => project.path,
    });
    const place = await targets.reserve({ projectId: project.id, name: '访谈' });
    expect(place).toMatchObject({ file: '访谈', scope: { projectId: project.id } });
    // 占下的目录让别的新建跳过它。
    const other = await client.request('videos.create', { projectId: project.id, name: '访谈' });
    expect(other.ref.relPath).toBe('访谈 2');
    await client.request('videos.close', { videoId: other.ref.videoId });

    const first = await targets.create({ projectId: project.id, name: '访谈', commandId: 'job_x:create', place });
    first.release();
    await until(() => runtime.videos.ref(first.videoId) === null);
    // 重试（新的进程里命令记录不在了）：同一个位置上已经有视频，认回它。
    const again = await targets.create({ projectId: project.id, name: '访谈', commandId: 'job_x:create:again', place });
    expect(again.videoId).toBe(first.videoId);
    again.release();
    expect((await fs.readdir(project.path)).filter((n) => !n.startsWith('.')).sort()).toEqual(['访谈', '访谈 2']);
    // 别的项目的位置拒绝。
    await expect(targets.create({ projectId: 'prj_other', name: 'x', commandId: 'c', place })).rejects.toMatchObject({
      code: 'invalid-request',
    });
  });

  it('媒体不在、不是绝对路径时拒绝，不新建视频、不建任务', async () => {
    const missing = await start('transcribe', {
      target: { create: { projectId: project.id, media: path.join(dir, 'nope.wav') } },
    }).catch((error: { details?: { code?: string } }) => error.details?.code);
    expect(missing).toBe('INPUT_NOT_FOUND');
    const relative = await start('transcribe', { target: { create: { projectId: project.id, media: 'a.wav' } } }).catch(
      (error: { code?: string }) => error.code,
    );
    expect(relative).toBe('invalid-request');
    expect((await fs.readdir(project.path)).filter((n) => !n.startsWith('.'))).toEqual([]);
    expect(await client.request('jobs.list', { children: true })).toEqual({ jobs: [] });
  });

  it('视频里启用的转写术语表：新建的视频采用库里默认启用的那份，转写 Job 冻结它的版本', async () => {
    const { entry: glossary } = await client.request('library.put', {
      library: 'glossaries',
      content: {
        name: '术语',
        kind: 'transcription',
        language: null,
        defaultEnabled: true,
        terms: [{ canonical: 'BaoCut', misheard: [] }],
      },
    });
    const { jobId } = await start('transcribe', { target: { create: { projectId: project.id, media } } });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as TranscribeSummary;
    expect(runtime.models.jobs.inspect(summary.transcribeJobId).library?.entries).toEqual([
      expect.objectContaining({ library: 'glossaries', id: glossary.id, version: glossary.version }),
    ]);
  });

  it('音频按 audio 授权：撤销默认授权后启动即拒绝，不新建视频；桌面界面带待批准项，批准之后同一个 commandId 重新提交', async () => {
    const byDefault = (await client.request('grants.list', { recipient: 'openai' })).grants.find((g) => g.origin === 'provider-enable')!;
    expect(byDefault.dataKinds).toContain('audio');
    await client.request('grants.revoke', { grantId: byDefault.grantId });
    const before = (await client.request('grants.list', { includeEnded: true })).grants.length;

    const commandId = newId('cmd');
    const begin = () =>
      client.request('pipelines.start', {
        pipeline: 'transcribe',
        params: { target: { create: { projectId: project.id, media } } },
        commandId,
      });
    const refused = (await begin().catch((e: unknown) => e)) as { code: string; details: Record<string, unknown> };
    expect(refused).toMatchObject({
      code: 'forbidden',
      details: { code: 'GRANT_REVOKED', recipient: 'openai', dataKinds: ['audio'], remedy: { action: 'create-grant' } },
    });
    const pending = refused.details.pendingGrants as GrantRequestItem[];
    expect(pending).toEqual([
      expect.objectContaining({
        capability: 'transcribe',
        recipient: 'openai',
        dataKinds: ['audio'],
        videoId: null,
        // 用途是 Runtime 写的：带着引用，界面按自己的语言重新生成。
        purposeRef: expect.objectContaining({ key: 'rcGrants.pipelinePurpose' }),
      }),
    ]);
    // 拒绝不发放授权、不新建视频、不建任务。
    expect((await client.request('grants.list', { includeEnded: true })).grants).toHaveLength(before);
    expect((await fs.readdir(project.path)).filter((n) => !n.startsWith('.'))).toEqual([]);
    expect(await client.request('jobs.list', { children: true })).toEqual({ jobs: [] });

    for (const item of pending) await client.request('grants.create', grantCreateParamsFor(item));
    const { jobId } = await begin();
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    expect((job.pipeline!.summary as unknown as TranscribeSummary).createdVideo).toBe(true);
  });
});
