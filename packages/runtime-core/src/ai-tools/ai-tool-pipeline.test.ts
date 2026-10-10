import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalog } from '@baocut/models';
import { JobManager, PipelineRunner, type TranscribeRouter } from '@baocut/jobs';
import type { TextGenerateRequest, TextResult } from '@baocut/models';
import { RpcError, type AiToolSummary, type DocumentRecord, type EditOperation, type JobRecord, type TextModelInfo } from '@baocut/protocol';
import { aiToolPipeline, parseAiToolParams, polishedBody, type AiToolDeps } from './ai-tool-pipeline.ts';
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
        state: (videoId) => (videoId === 'vid_1' ? { revision: `v-${revision}`, rootSequenceId: 'seq_1', documents: docs() } : null),
        sequence: () => ({ duration: 120, chapters: 2 }),
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
      words: async (_videoId, { range }) => (range ? WORDS.slice(2) : WORDS),
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
      context: { paragraphs: 2, characters: 4, chapters: 2, attachments: 1, skippedAttachments: 1, skills: ['video-summary', 'mine'], references: 2 },
    });
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
});
