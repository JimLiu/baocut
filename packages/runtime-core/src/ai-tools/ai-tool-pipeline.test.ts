import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalog } from '@baocut/models';
import { JobManager, PipelineRunner, type TranscribeRouter } from '@baocut/jobs';
import type { TextGenerateRequest, TextResult } from '@baocut/models';
import { RpcError, type AiToolSummary, type DocumentRecord, type EditOperation, type JobRecord, type TextModelInfo } from '@baocut/protocol';
import { aiToolPipeline, parseAiToolParams, polishedBody, type AiToolDeps } from './ai-tool-pipeline.ts';
import type { RelevantChunk, RelevantChunkSet, TopicUnit } from '../space/semantic/context.ts';
import { aiToolMessages, chapterDrafts, parseTimestamp, polishBatches, polishEdits, type ContextWord } from './ai-tool-prompt.ts';

/**
 * AI 工具「直接调模型」（产品设计 §5.10）：交给模型的消息（系统提示词是 skill、用户消息是提示词与上下文）、润色与章节的
 * 校验，以及对着假的视频、假的文本模型跑完整条流程：只给结果的工具不写视频；润色与章节一笔写进视频；文稿中途改了不写。
 */

const word = (id: string, text: string, start: number, paragraphStart = false): ContextWord => ({ id, text, start, paragraphStart });

describe('交给模型的消息', () => {
  it('系统提示词：skill 在前、工具的输出格式在后；没有 skill 时只有输出格式', () => {
    const [system, user] = aiToolMessages({
      tool: 'summary',
      system: '<skill id="video-summary">RULES</skill>',
      prompt: 'Summarize chapter 2',
      transcript: '# Intro\n\nHello world. [00:05]',
      attachments: [{ name: 'notes.txt', content: 'Glossary: BaoCut' }],
    });
    expect(system!.role).toBe('system');
    expect(system!.content.indexOf('RULES')).toBeLessThan(system!.content.indexOf('Output:'));
    expect(user!.content).toContain('<request>\nSummarize chapter 2\n</request>');
    expect(user!.content).toContain('<transcript>\n# Intro\n\nHello world. [00:05]\n</transcript>');
    expect(user!.content).toContain('<attachment name="notes.txt">\nGlossary: BaoCut\n</attachment>');

    const [bare, only] = aiToolMessages({ tool: 'title', system: '', prompt: 'Titles', transcript: null, attachments: [] });
    expect(bare!.content.startsWith('Output:')).toBe(true);
    expect(only!.content).toBe('<request>\nTitles\n</request>');
  });

  it('系统提示词：给了界面语言时在 skill 与输出格式之间说明，不给时不写', () => {
    const [system] = aiToolMessages({ tool: 'summary', system: 'RULES', prompt: '', transcript: null, attachments: [], uiLanguage: 'zh-Hans' });
    expect(system!.content).toBe(`RULES\n\nThe user's interface language is zh-Hans.\n\n${system!.content.slice(system!.content.indexOf('Output:'))}`);
    const [bare] = aiToolMessages({ tool: 'summary', system: '', prompt: '', transcript: null, attachments: [] });
    expect(bare!.content).not.toContain('interface language');
  });

  it('润色给编了号的词，段落之间空一行', () => {
    const words = [word('w1', 'Hello', 0, true), word('w2', 'world', 1), word('w3', 'Next', 5, true)];
    const [, user] = aiToolMessages({ tool: 'polish', system: '', prompt: '', transcript: null, words: { items: words, offset: 0, total: 3 }, attachments: [] });
    expect(user!.content).toContain('<transcript words="1-3" total="3">\n1\tHello\n2\tworld\n\n3\tNext\n</transcript>');
  });

  it('润色按段落分批；一段超过上限时整段成一批', () => {
    const words = [word('a', 'a', 0, true), word('b', 'b', 1), word('c', 'c', 2, true), word('d', 'd', 3), word('e', 'e', 4), word('f', 'f', 5, true)];
    expect(polishBatches(words, 3).map((b) => [b.offset, b.items.map((w) => w.id).join('')])).toEqual([
      [0, 'ab'],
      [2, 'cde'],
      [5, 'f'],
    ]);
    expect(polishBatches(words, 2).map((b) => b.items.length)).toEqual([2, 3, 1]);
    expect(polishBatches([], 10)).toEqual([]);
  });

  it('润色的修改：编号在这一批里、不空、不换行；与原文相同的不算', () => {
    const batch = { offset: 10, items: [word('w11', 'teh', 0), word('w12', 'cat', 1)] };
    const ok = polishEdits({ edits: [{ n: 11, text: 'the' }, { n: 12, text: 'cat' }] }, batch);
    expect('edits' in ok && [...ok.edits]).toEqual([['w11', 'the']]);
    expect(polishEdits({ edits: [{ n: 3, text: 'x' }] }, batch)).toHaveProperty('problem');
    expect(polishEdits({ edits: [{ n: 11, text: '  ' }] }, batch)).toHaveProperty('problem');
    expect(polishEdits({ edits: [{ n: 11, text: 'a\nb' }] }, batch)).toHaveProperty('problem');
    expect(polishEdits({ nope: [] }, batch)).toHaveProperty('problem');
  });

  it('润色写回：只改 text，别的字段与词的个数、顺序不变', () => {
    const body = { schema: 'baocut.speech/1', words: [{ id: 'w1', text: 'teh', start: 0 }, { id: 'w2', text: 'cat', start: 1 }], speakers: [] };
    const out = polishedBody(body, { w1: 'the', w2: 'cat' });
    expect(out.changes).toBe(1);
    expect(out.body).toEqual({ ...body, words: [{ id: 'w1', text: 'the', start: 0 }, body.words[1]] });
  });

  it('章节：时间码认得出、吸到最近的段落起点、去重排序、标题不空、落在视频里', () => {
    expect(parseTimestamp('[01:02]')).toBe(62);
    expect(parseTimestamp('1:00:05.5')).toBe(3605.5);
    expect(parseTimestamp('75')).toBe(75);
    expect(parseTimestamp('1:75')).toBeNull();
    expect(parseTimestamp('soon')).toBeNull();
    const chapters = chapterDrafts(
      {
        chapters: [
          { at: '02:01', title: 'Second', summary: 'Two' },
          { at: '00:00', title: ' Intro ', summary: 'One' },
          { at: '02:03', title: 'Duplicate', summary: 'Snaps to the same start' },
          { at: '09:00', title: 'Past the end', summary: '' },
          { at: '01:00', title: '', summary: 'No title' },
        ],
      },
      [0, 60, 120],
      300,
    );
    expect(chapters).toEqual([
      { at: 0, title: 'Intro', summary: 'One' },
      { at: 120, title: 'Second', summary: 'Two' },
    ]);
    expect(chapterDrafts({ chapters: 'x' }, [0], 10)).toEqual([]);
  });

  it('参数：工具与范围按协议校验，不合时 invalid-request 并指出哪个键', () => {
    expect(parseAiToolParams({ videoId: 'v', tool: 'blog', prompt: 'p' })).toEqual({ videoId: 'v', tool: 'blog', prompt: 'p' });
    expect(parseAiToolParams({ videoId: 'v', tool: 'blog', prompt: 'p', uiLanguage: 'pt-BR' })).toEqual({ videoId: 'v', tool: 'blog', prompt: 'p', uiLanguage: 'pt-BR' });
    expect(() => parseAiToolParams({ videoId: 'v', tool: 'blog', prompt: 'p', uiLanguage: 'not a tag' })).toThrow(expect.objectContaining({ code: 'invalid-request', details: expect.objectContaining({ key: 'uiLanguage' }) }));
    expect(() => parseAiToolParams({ videoId: 'v', tool: 'cover', prompt: 'p' })).toThrow(expect.objectContaining({ code: 'invalid-request', details: expect.objectContaining({ key: 'tool' }) }));
    expect(() => parseAiToolParams({ videoId: 'v', tool: 'chapters', prompt: 'p', range: { start: 0, end: 5 } })).toThrow(RpcError);
    // 按主题与系列文章只给写作类工具；按主题不与范围同用；另几部不含这一部、不重复。边界只给章节。
    expect(parseAiToolParams({ videoId: 'v', tool: 'blog', prompt: 'p', selection: { mode: 'topic', limit: 12 }, videoIds: ['w'] })).toMatchObject({ selection: { mode: 'topic', limit: 12 } });
    const bad = [
      { tool: 'polish', selection: { mode: 'topic' } },
      { tool: 'chapters', videoIds: ['w'] },
      { tool: 'blog', selection: { mode: 'topic' }, range: { start: 0, end: 5 } },
      { tool: 'blog', videoIds: ['v'] },
      { tool: 'blog', videoIds: ['w', 'w'] },
      { tool: 'blog', selection: { mode: 'topic', limit: 61 } },
      { tool: 'blog', boundaries: 'topic' },
    ];
    for (const extra of bad) expect(() => parseAiToolParams({ videoId: 'v', prompt: 'p', ...extra }), JSON.stringify(extra)).toThrow(RpcError);
    expect(parseAiToolParams({ videoId: 'v', tool: 'chapters', prompt: 'p', boundaries: 'topic' })).toMatchObject({ boundaries: 'topic' });
  });
});

const MODEL: TextModelInfo = {
  modelId: 'writer',
  label: 'Writer',
  default: true,
  contextTokens: 100_000,
  maxOutputTokens: 4000,
  efforts: [],
  defaultEffort: null,
  structuredOutput: true,
  acceptsTemperature: false,
  acceptsSeed: false,
  cost: 'unknown',
};

const WORDS: ContextWord[] = [word('w1', 'Helo', 0, true), word('w2', 'world.', 1), word('w3', 'Second', 60, true), word('w4', 'part.', 61)];

describe('ai-tool 流程', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let requests: TextGenerateRequest[];
  let reply: (request: TextGenerateRequest) => Partial<TextResult>;
  let applied: EditOperation[][];
  let revision: string;
  let structured: boolean;
  let skillCalls: number;
  let attachmentDir: string;
  let sentences: Map<string, string>;
  let relevantSet: RelevantChunkSet;
  let relevantCalls: Array<{ videoIds: string[]; intent: string; limit: number }>;
  let secondOpen: boolean;
  let wordList: ContextWord[];
  let duration: number;
  let embed: (texts: string[]) => Promise<Float32Array[]>;
  let units: TopicUnit[] | null;

  const docs = (): Record<string, DocumentRecord> => ({ doc_1: { id: 'doc_1', kind: 'speech', currentRevision: revision } as DocumentRecord });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-ai-tool-'));
    attachmentDir = path.join(dir, 'attachments');
    await fs.mkdir(attachmentDir);
    requests = [];
    applied = [];
    revision = 'r1';
    structured = true;
    skillCalls = 0;
    sentences = new Map();
    relevantCalls = [];
    secondOpen = false;
    wordList = WORDS;
    duration = 120;
    embed = async () => {
      throw new RpcError('conflict', 'no model', { reason: 'MODEL_NOT_INSTALLED' });
    };
    units = null;
    relevantSet = { chunks: [], coverage: { chapters: [], indexed: false, stale: false }, effectiveMode: 'none', reason: 'MODEL_NOT_INSTALLED' };
    reply = () => ({ text: 'RESULT' });
    const router: TranscribeRouter = {
      selectTranscribe: async () => {
        throw new Error('不转写');
      },
      transcriber: () => null,
      executors: () => [],
    };
    jobs = new JobManager({
      paths: {
        jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
        stagingDir: path.join(dir, 'staging'),
        artifactsDir: path.join(dir, 'artifacts'),
        diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
      },
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router,
      videos: {
        retain: () => {},
        release: () => {},
        source: async () => {
          throw new Error('没有素材');
        },
        current: () => null,
        videoRevision: () => null,
        apply: async () => ({}),
      },
    });
    await jobs.open();
    const deps: AiToolDeps = {
      videos: {
        state: (videoId) =>
          videoId === 'vid_1' || (videoId === 'vid_2' && secondOpen) ? { revision: `v-${revision}`, rootSequenceId: 'seq_1', documents: docs() } : null,
        sequence: () => ({ duration, chapters: 2, chapterMarks: [{ at: 0, title: 'Intro' }, { at: 60, title: 'Second' }] }),
        document: async () => ({
          revision,
          body: { schema: 'baocut.speech/1', words: WORDS.map((w) => ({ id: w.id, text: w.text })), speakers: [] },
        }),
        apply: async (_videoId, request) => {
          applied.push(request.operations);
          return { transactionId: `txn_${applied.length}` };
        },
      },
      text: {
        generate: async (request) => {
          requests.push(request);
          return { providerId: 'fake', modelId: 'writer', text: '', finishReason: 'stop', usage: null, modelVersion: null, effort: { requested: null, applied: null }, notes: [], workerVersion: 'fake', ...reply(request) } as TextResult;
        },
      },
      selectText: async () => ({ providerId: 'fake', modelId: 'writer', model: { ...MODEL, structuredOutput: structured } }),
      transcript: async (_videoId, { range }) => ({
        content: range ? '**A:** Second part. [01:00]' : '## Intro\n\n**A:** Helo world. [00:00]\n\n**A:** Second part. [01:00]',
        paragraphs: range ? 1 : 2,
        characters: range ? 2 : 4,
      }),
      words: async (_videoId, { range }) => (range ? WORDS.slice(2) : wordList),
      sentenceOf: async () => sentences,
      skills: async (refs) => {
        skillCalls += 1;
        return { text: refs.map((r) => `<skill id="${r.id}">BODY</skill>`).join('\n'), skills: refs.map((r) => r.id), references: refs.length };
      },
      attachments: async (ids) =>
        ids.map((id) => ({
          ref: id === 'att_img'
            ? { id, kind: 'image' as const, fileName: 'frame.png', mimeType: 'image/png', size: 3 }
            : { id, kind: 'file' as const, fileName: 'notes.txt', mimeType: 'text/plain', size: 16 },
          path: path.join(attachmentDir, id),
        })),
      artifacts: jobs.artifacts,
      embed: (texts) => embed(texts),
      topicUnits: async () => units,
      relevant: async ({ videoIds, intent, limit }) => {
        relevantCalls.push({ videoIds, intent, limit });
        return relevantSet;
      },
    };
    await fs.writeFile(path.join(attachmentDir, 'att_txt'), 'Glossary: BaoCut');
    await fs.writeFile(path.join(attachmentDir, 'att_img'), 'PNG');
    runner = new PipelineRunner({ jobs, stagingDir: path.join(dir, 'staging'), definitions: [aiToolPipeline(deps)] });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function run(params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', prompt: 'Do it', ...params } }, { kind: 'connection', id: 'conn_1' });
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  it('只给结果的工具：一次正文调用，skill 作为系统提示词，附件只带文本，不写视频', async () => {
    const record = await run({ tool: 'summary', skills: [{ id: 'video-summary' }, { id: 'mine' }], attachments: ['att_txt', 'att_img'], uiLanguage: 'zh-Hans' });
    expect(record.state).toBe('completed');
    expect(record.pipeline!.steps.map((s) => [s.name, s.status])).toEqual([
      ['context', 'completed'],
      ['generate', 'completed'],
      ['apply', 'skipped'],
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.responseFormat).toEqual({ type: 'text' });
    expect(requests[0]!.messages[0]!.content).toContain('<skill id="video-summary">BODY</skill>\n<skill id="mine">BODY</skill>');
    expect(requests[0]!.messages[0]!.content).toContain("The user's interface language is zh-Hans.");
    expect(requests[0]!.messages[1]!.content).toContain('<transcript>\n## Intro');
    expect(requests[0]!.messages[1]!.content).toContain('Glossary: BaoCut');
    expect(requests[0]!.messages[1]!.content).not.toContain('PNG');
    expect(applied).toEqual([]);
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary).toMatchObject({
      tool: 'summary',
      providerId: 'fake',
      modelId: 'writer',
      applied: null,
      text: 'RESULT',
      finishReason: 'stop',
      // 转写读不出句子：退回导出文稿的写法，不发出处。
      citations: null,
      citationsArtifactId: null,
      context: { paragraphs: 2, characters: 4, chapters: 2, attachments: 1, skippedAttachments: 1, skills: ['video-summary', 'mine'], references: 2 },
    });
  });

  it('写作的出处：文稿是编了号的句子，段末的编号校验后对应回原句，正文去掉编号', async () => {
    sentences = new Map([
      ['w1', 's-w1'],
      ['w2', 's-w1'],
      ['w3', 's-w3'],
      ['w4', 's-w3'],
    ]);
    reply = () => ({ text: '## Overview\n\nThey say hello. [s1]\n\nThen the second part [s2, s9].\n\nA conclusion of my own.' });
    const record = await run({ tool: 'blog' });
    expect(record.state).toBe('completed');
    const sent = requests[0]!.messages[1]!.content as string;
    expect(sent).toContain('## Intro [00:00]\n[s1] [00:00] Helo world.\n\n## Second [01:00]\n[s2] [01:00] Second part.');
    expect(requests[0]!.messages[0]!.content).toContain('cite the numbers of the sentences');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.text).toBe('## Overview\n\nThey say hello.\n\nThen the second part.\n\nA conclusion of my own.');
    expect(summary.citationsArtifactId).toMatch(/^sha256:/);
    const file = summary.citations!;
    expect(file).toMatchObject({ schema: 'baocut.citations/1', videoIds: ['vid_1'], effectiveMode: 'none', droppedCites: 1 });
    expect(file.paragraphs.map((p) => [p.role, p.inferred, p.cites.map((c) => c.sentenceIds)])).toEqual([
      ['heading', false, []],
      ['body', false, [['s-w1']]],
      ['body', false, [['s-w3']]],
      ['body', true, []],
    ]);
    expect(file.paragraphs[2]!.cites[0]).toMatchObject({ videoId: 'vid_1', documentId: 'doc_1', clock: 'sequence', startSec: 60, text: 'Second part.' });
    // 正文与出处都是产物：Space 的文档条目从正文的产物派生。
    expect((await jobs.artifacts.read(summary.artifactId))!.toString('utf8')).toBe(summary.text);
    expect(JSON.parse((await jobs.artifacts.read(summary.citationsArtifactId!))!.toString('utf8'))).toEqual(file);
  });

  it('范围：文稿只取这一段', async () => {
    const record = await run({ tool: 'blog', range: { start: 60, end: 120 } });
    expect(record.state).toBe('completed');
    expect(requests[0]!.messages[1]!.content).toContain('<transcript>\n**A:** Second part. [01:00]\n</transcript>');
    expect((record.pipeline!.summary as unknown as AiToolSummary).context.paragraphs).toBe(1);
  });

  it('润色：结构化输出，改过的词一笔写回同一份转写', async () => {
    reply = () => ({ json: { edits: [{ n: 1, text: 'Hello' }, { n: 4, text: 'part.' }] } });
    const record = await run({ tool: 'polish' });
    expect(record.state).toBe('completed');
    expect(requests[0]!.responseFormat).toMatchObject({ type: 'json', name: 'edits' });
    expect(requests[0]!.messages[1]!.content).toContain('1\tHelo\n2\tworld.\n\n3\tSecond\n4\tpart.');
    expect(applied).toHaveLength(1);
    const op = applied[0]![0] as Extract<EditOperation, { type: 'putDocument' }>;
    expect(op).toMatchObject({ type: 'putDocument', documentId: 'doc_1', kind: 'speech' });
    expect((op.body as { words: Array<{ text: string }> }).words.map((w) => w.text)).toEqual(['Hello', 'world.', 'Second', 'part.']);
    expect((record.pipeline!.summary as unknown as AiToolSummary).applied).toEqual({ transactionId: 'txn_1', changes: 1 });
  });

  it('润色：编号对不上时失败，不写视频', async () => {
    reply = () => ({ json: { edits: [{ n: 9, text: 'x' }] } });
    const record = await run({ tool: 'polish' });
    expect(record.state).toBe('failed');
    expect(record.error).toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(applied).toEqual([]);
  });

  it('润色：模型工作期间文稿改了，以 STALE_JOB_INPUT 失败，不写', async () => {
    reply = () => {
      revision = 'r2';
      return { json: { edits: [{ n: 1, text: 'Hello' }] } };
    };
    const record = await run({ tool: 'polish' });
    expect(record.state).toBe('failed');
    expect(record.error).toMatchObject({ code: 'STALE_JOB_INPUT' });
    expect(applied).toEqual([]);
    // 重试：从当前版本重新收集、重新调用；skill 与附件沿用冻结的，不再读。
    const before = skillCalls;
    reply = () => ({ json: { edits: [{ n: 1, text: 'Hello' }] } });
    await runner.retry(record.jobId);
    await jobs.settled(record.jobId);
    await runner.idle();
    expect(jobs.inspect(record.jobId).state).toBe('completed');
    expect(applied).toHaveLength(1);
    expect(skillCalls).toBe(before);
  });

  it('章节：整份写进根序列，时间吸到段落起点', async () => {
    reply = () => ({ json: { chapters: [{ at: '00:00', title: 'Intro', summary: 'Hello' }, { at: '00:58', title: 'Second', summary: 'Part' }] } });
    const record = await run({ tool: 'chapters' });
    expect(record.state).toBe('completed');
    expect(applied[0]).toEqual([
      {
        type: 'setChapters',
        sequenceId: 'seq_1',
        chapters: [
          { at: { unit: 'seconds', value: '0.000' }, title: 'Intro', summary: 'Hello' },
          { at: { unit: 'seconds', value: '60.000' }, title: 'Second', summary: 'Part' },
        ],
        alignment: 'nearest-frame',
      },
    ]);
    expect((record.pipeline!.summary as unknown as AiToolSummary).applied).toEqual({ transactionId: 'txn_1', changes: 2 });
  });

  it('润色与章节要模型支持结构化输出：不支持时启动就拒绝', async () => {
    structured = false;
    await expect(runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', tool: 'chapters', prompt: '' } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({ code: 'invalid-request' });
    // 正文工具不要求结构化输出。
    expect((await run({ tool: 'title' })).state).toBe('completed');
  });

  it('视频没有打开：启动就拒绝', async () => {
    await expect(runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_x', tool: 'desc', prompt: '' } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({ code: 'not-found' });
  });

  const chunk = (chunkId: string, videoId: string, chapter: string | null, rows: Array<[string, string, number, number]>, weak = false): RelevantChunk => ({
    chunkId,
    videoId,
    documentId: 'doc_1',
    documentKind: 'speech',
    sentenceIds: rows.map((r) => r[0]),
    text: rows.map((r) => r[1]).join(' '),
    anchor: { clock: 'sequence', start: { ticks: '0', timescale: 1 }, end: { ticks: '0', timescale: 1 } },
    ...(chapter ? { chapter: { id: chapter, title: chapter } } : {}),
    score: weak ? 0.5 : 0.9,
    ...(weak ? { weak: true } : {}),
    sentences: rows.map(([sentenceId, text, start, end]) => ({ sentenceId, documentId: 'doc_1', text, clock: 'sequence', start, end, speaker: 'A', neighbor: false })),
  });

  it('按主题选材：意图句找来的句群按时间编号、跳过的地方写省略号，勾掉的不发；怎么选的冻结在任务里', async () => {
    relevantSet = {
      chunks: [
        chunk('c1', 'vid_1', 'Intro', [['s-a', 'We picked a model.', 10, 14], ['s-b', 'It was cheap.', 14, 16]]),
        chunk('c2', 'vid_1', 'Second', [['s-c', 'Latency mattered most.', 300, 304]], true),
        chunk('c3', 'vid_1', 'Second', [['s-d', 'Unrelated aside.', 400, 402]]),
      ],
      coverage: { chapters: ['Intro', 'Second'], indexed: true, stale: false },
      effectiveMode: 'semantic',
      reason: null,
    };
    reply = () => ({ text: 'We chose a cheap model. [s1, s2]\n\nSpeed decided it. [s3]' });
    const record = await run({ tool: 'blog', prompt: 'Write about model choice', selection: { mode: 'topic', exclude: ['c3'] } });
    expect(record.state).toBe('completed');
    expect(relevantCalls).toEqual([{ videoIds: ['vid_1'], intent: 'Write about model choice', limit: 24 }]);
    const sent = requests[0]!.messages[1]!.content as string;
    expect(sent).toContain('## Intro\n[s1] [00:10] A: We picked a model.\n[s2] [00:14] A: It was cheap.\n…\n\n## Second\n[s3] [05:00] A: Latency mattered most.');
    expect(sent).not.toContain('Unrelated aside');
    expect(requests[0]!.messages[0]!.content).toContain('selection of excerpts');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.context.selection).toEqual({ effectiveMode: 'semantic', reason: null, chunks: 2, chunkIds: ['c1', 'c2'], chapters: ['Intro', 'Second'], weak: 1 });
    expect(summary.context.paragraphs).toBe(2);
    expect(summary.citations).toMatchObject({ effectiveMode: 'semantic', videoIds: ['vid_1'], droppedCites: 0 });
    expect(summary.citations!.paragraphs[1]!.cites[0]).toMatchObject({ sentenceIds: ['s-c'], startSec: 300 });
  });

  it('按主题选材挑不出来（没有模型、没有索引）：发整篇，写明原因', async () => {
    const record = await run({ tool: 'summary', selection: { mode: 'topic', intent: 'pricing' } });
    expect(record.state).toBe('completed');
    expect(requests[0]!.messages[1]!.content).toContain('<transcript>\n## Intro');
    expect(requests[0]!.messages[0]!.content).not.toContain('selection of excerpts');
    expect((record.pipeline!.summary as unknown as AiToolSummary).context.selection).toEqual({
      effectiveMode: 'none',
      reason: 'MODEL_NOT_INSTALLED',
      chunks: 0,
      chunkIds: [],
      chapters: [],
      weak: 0,
    });
  });

  it('系列文章（按主题）：另几部不必打开，编号带视频前缀，出处带视频', async () => {
    relevantSet = {
      chunks: [chunk('c2', 'vid_2', null, [['s-x', 'Part two opens.', 5, 7]]), chunk('c1', 'vid_1', null, [['s-a', 'Part one ends.', 50, 52]])],
      coverage: { chapters: [], indexed: true, stale: false },
      effectiveMode: 'lexical',
      reason: 'MODEL_NOT_INSTALLED',
    };
    reply = () => ({ text: 'One then two. [v1:s1, v2:s1]' });
    const record = await run({ tool: 'blog', videoIds: ['vid_2'], selection: { mode: 'topic' } });
    expect(record.state).toBe('completed');
    expect(relevantCalls[0]!.videoIds).toEqual(['vid_1', 'vid_2']);
    expect(requests[0]!.messages[1]!.content).toContain('# v1\n[v1:s1] [00:50] A: Part one ends.\n\n# v2\n[v2:s1] [00:05] A: Part two opens.');
    expect(requests[0]!.messages[0]!.content).toContain('from 2 videos');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.context).toMatchObject({ videos: 2, selection: { effectiveMode: 'lexical', reason: 'MODEL_NOT_INSTALLED' } });
    expect(summary.citations!.videoIds).toEqual(['vid_1', 'vid_2']);
    expect(summary.citations!.paragraphs[0]!.cites.map((c) => c.videoId)).toEqual(['vid_1', 'vid_2']);
  });

  it('系列文章（整篇）：另几部要打开着，各自编号；智能体与对外服务不能选几部视频', async () => {
    await expect(runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', tool: 'blog', prompt: '', videoIds: ['vid_2'] } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'VIDEO_NOT_OPEN', videoId: 'vid_2' },
    });
    secondOpen = true;
    sentences = new Map([
      ['w1', 's-w1'],
      ['w2', 's-w1'],
      ['w3', 's-w3'],
      ['w4', 's-w3'],
    ]);
    reply = () => ({ text: 'Both start the same way. [v1:s1, v2:s1]' });
    const record = await run({ tool: 'blog', videoIds: ['vid_2'] });
    expect(record.state).toBe('completed');
    const sent = requests[0]!.messages[1]!.content as string;
    expect(sent).toContain('# v1\n## Intro [00:00]\n[v1:s1] [00:00] Helo world.');
    expect(sent).toContain('# v2\n## Intro [00:00]\n[v2:s1] [00:00] Helo world.');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.context).toMatchObject({ videos: 2, paragraphs: 4 });
    expect(summary.citations!.paragraphs[0]!.cites.map((c) => c.videoId)).toEqual(['vid_1', 'vid_2']);
    await expect(
      runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', tool: 'blog', prompt: '', videoIds: ['vid_2'] } }, { kind: 'agent', id: 'agt_1', taskId: 'task_1' }),
    ).rejects.toMatchObject({ code: 'forbidden', details: { code: 'SERIES_USER_ONLY' } });
  });

  it('章节按话题找边界：段落向量的转折是候选，模型只能在第一段与候选处分章（可以合并，不能新增）', async () => {
    duration = 600;
    const topics = ['alpha', 'alpha', 'alpha', 'beta', 'beta', 'beta'];
    wordList = topics.flatMap((topic, i) => [word(`p${i}a`, topic, i * 60, true), word(`p${i}b`, `talk${i}.`, i * 60 + 30)]);
    embed = async (texts) => texts.map((text) => Float32Array.from(text.startsWith('alpha') ? [1, 0] : [0, 1]));
    reply = () => ({
      json: {
        chapters: [
          { at: '00:00', title: 'Alpha', summary: 'A' },
          { at: '02:58', title: 'Beta', summary: 'B' },
          // 不在候选处：吸到最近的候选（03:00）上，与上一章重了，丢掉。
          { at: '04:00', title: 'Extra', summary: 'X' },
        ],
      },
    });
    const record = await run({ tool: 'chapters', boundaries: 'topic' });
    expect(record.state).toBe('completed');
    expect(requests[0]!.messages[0]!.content).toContain('never start a chapter anywhere else');
    expect(requests[0]!.messages[1]!.content).toContain('<chapter_candidates>\n[03:00] … alpha talk2. ‖ beta talk3. …\n</chapter_candidates>');
    const op = applied[0]![0] as Extract<EditOperation, { type: 'setChapters' }>;
    expect(op.chapters.map((c) => [c.at, c.title])).toEqual([
      [{ unit: 'seconds', value: '0.000' }, 'Alpha'],
      [{ unit: 'seconds', value: '180.000' }, 'Beta'],
    ]);
    expect((record.pipeline!.summary as unknown as AiToolSummary).context.boundaries).toEqual({ mode: 'topic', candidates: 1, reason: null });
  });

  it('章节按话题找边界而这一版已建好语义索引：用索引的句群与向量，不重新编码；候选吸到附近的段落开头', async () => {
    duration = 600;
    const topics = ['alpha', 'alpha', 'alpha', 'beta', 'beta', 'beta'];
    wordList = topics.flatMap((topic, i) => [word(`p${i}a`, topic, i * 60, true), word(`p${i}b`, `talk${i}.`, i * 60 + 30)]);
    // 索引的句群每 30 秒一个、比段落细；话题在 185 秒（一句的开头）转折，离 180 秒的段落开头 5 秒。
    units = Array.from({ length: 11 }, (_, i) => {
      const start = i === 0 ? 0 : i * 30 + 5;
      return { start, end: i === 10 ? 330 : (i + 1) * 30 + 5, text: `unit${i}`, vector: Float32Array.from(start < 185 ? [1, 0] : [0, 1]) };
    });
    let embedded = 0;
    embed = async (texts) => {
      embedded += texts.length;
      return texts.map(() => Float32Array.from([1, 0]));
    };
    reply = () => ({ json: { chapters: [{ at: '00:00', title: 'Alpha', summary: 'A' }, { at: '03:00', title: 'Beta', summary: 'B' }] } });
    const record = await run({ tool: 'chapters', boundaries: 'topic' });
    expect(record.state).toBe('completed');
    expect(embedded).toBe(0);
    expect(requests[0]!.messages[1]!.content).toContain('<chapter_candidates>\n[03:00] … unit5 ‖ unit6 …\n</chapter_candidates>');
    expect((record.pipeline!.summary as unknown as AiToolSummary).context.boundaries).toEqual({ mode: 'topic', candidates: 1, reason: null });
    // 索引的终点与文稿对不上（时间线改过、还没重建）：不信索引，现算段落向量。
    units = units.map((u) => ({ ...u, end: u.end + 40 }));
    requests = [];
    await run({ tool: 'chapters', boundaries: 'topic' });
    expect(embedded).toBe(6);
  });

  it('章节按话题找边界而没有语义模型：退回由模型决定，写明原因', async () => {
    wordList = [0, 30, 60, 90].map((at, i) => word(`p${i}`, `part${i}.`, at, true));
    reply = () => ({ json: { chapters: [{ at: '00:00', title: 'Intro', summary: 'Hello' }, { at: '01:00', title: 'Second', summary: 'Part' }] } });
    const record = await run({ tool: 'chapters', boundaries: 'topic' });
    expect(record.state).toBe('completed');
    expect(requests[0]!.messages[1]!.content).not.toContain('<chapter_candidates>');
    expect((record.pipeline!.summary as unknown as AiToolSummary).context.boundaries).toEqual({ mode: 'model', candidates: 0, reason: 'MODEL_NOT_INSTALLED' });
    expect((applied[0]![0] as Extract<EditOperation, { type: 'setChapters' }>).chapters).toHaveLength(2);
  });

  it('重写一段：材料是这段原来的出处加再挑的句群，连同大纲发给模型；只换掉这一段，其余段落与出处原样', async () => {
    sentences = new Map([
      ['w1', 's-w1'],
      ['w2', 's-w1'],
      ['w3', 's-w3'],
      ['w4', 's-w3'],
    ]);
    reply = () => ({ text: '## Overview\n\nThey say hello. [s1]\n\nThen the second part [s2].\n\nA conclusion of my own.' });
    const first = (await run({ tool: 'blog' })).pipeline!.summary as unknown as AiToolSummary;
    relevantSet = {
      chunks: [chunk('c9', 'vid_1', 'Intro', [['s-e', 'Extra detail.', 30, 32]])],
      coverage: { chapters: ['Intro'], indexed: true, stale: false },
      effectiveMode: 'semantic',
      reason: null,
    };
    requests = [];
    reply = () => ({ text: 'They greet the world warmly. [s1, s2]' });
    const record = await run({ tool: 'blog', prompt: 'Make it warmer', section: { citationsArtifactId: first.citationsArtifactId, index: 1 } });
    expect(record.state).toBe('completed');
    expect(relevantCalls.at(-1)).toEqual({ videoIds: ['vid_1'], intent: 'They say hello.', limit: 8 });
    const [system, user] = requests[0]!.messages;
    expect(system!.content).toContain('a replacement for the single paragraph');
    expect(system!.content).not.toContain('the blog post itself');
    expect(user!.content).toContain('<outline>\n1. ## Overview\n>> 2. They say hello.\n3. Then the second part.\n4. A conclusion of my own.\n</outline>');
    expect(user!.content).toContain('<paragraph_to_rewrite>\nThey say hello.\n</paragraph_to_rewrite>');
    expect(user!.content).toContain('[s1] [00:00] Helo world.\n…\n\n## Intro\n[s2] [00:30] A: Extra detail.');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.text).toBe('## Overview\n\nThey greet the world warmly.\n\nThen the second part.\n\nA conclusion of my own.');
    expect(summary.context.section).toEqual({ index: 1, paragraphs: 1 });
    expect(summary.citations!.paragraphs.map((p) => [p.index, p.cites.flatMap((c) => c.sentenceIds)])).toEqual([
      [0, []],
      [1, ['s-w1', 's-e']],
      [2, ['s-w3']],
      [3, []],
    ]);
    expect(summary.citationsArtifactId).not.toBe(first.citationsArtifactId);
    // 标题段不能重写；出处旁文件找不到时启动就拒绝。
    await expect(runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', tool: 'blog', prompt: '', section: { citationsArtifactId: first.citationsArtifactId!, index: 0 } } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(runner.start({ pipeline: 'ai-tool', params: { videoId: 'vid_1', tool: 'blog', prompt: '', section: { citationsArtifactId: 'sha256:nope', index: 1 } } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'CITATIONS_NOT_FOUND' },
    });
  });

  it('换材料重写：排除的原出处（cite:序号）与句群都不进材料，新段落只引留下的', async () => {
    sentences = new Map([
      ['w1', 's-w1'],
      ['w2', 's-w1'],
      ['w3', 's-w3'],
      ['w4', 's-w3'],
    ]);
    reply = () => ({ text: '## Overview\n\nThey say hello. [s1]\n\nThen the second part [s2].' });
    const first = (await run({ tool: 'blog' })).pipeline!.summary as unknown as AiToolSummary;
    relevantSet = {
      chunks: [chunk('c9', 'vid_1', 'Intro', [['s-e', 'Extra detail.', 30, 32]]), chunk('c8', 'vid_1', 'Intro', [['s-x', 'Skip me.', 40, 42]])],
      coverage: { chapters: ['Intro'], indexed: true, stale: false },
      effectiveMode: 'semantic',
      reason: null,
    };
    requests = [];
    reply = () => ({ text: 'Only the extra detail. [s1]' });
    const record = await run({ tool: 'blog', prompt: '', section: { citationsArtifactId: first.citationsArtifactId, index: 1, exclude: ['cite:0', 'c8'] } });
    expect(record.state).toBe('completed');
    const user = requests[0]!.messages[1]!.content;
    expect(user).not.toContain('Helo world.');
    expect(user).not.toContain('Skip me.');
    expect(user).toContain('[s1] [00:30] A: Extra detail.');
    const summary = record.pipeline!.summary as unknown as AiToolSummary;
    expect(summary.citations!.paragraphs[1]!.cites.flatMap((c) => c.sentenceIds)).toEqual(['s-e']);
  });
});
