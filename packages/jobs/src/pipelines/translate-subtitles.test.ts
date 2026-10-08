import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type JobRecord, type TextModelInfo } from '@baocut/protocol';
import { TextRunner, createTextGenerator, type TextProvider, type TextReply, type TextRun, type TextSelection } from '@baocut/models';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import { parseSubtitles } from './subtitle-file.ts';
import { parseTranslateSubtitlesParams, translateSubtitlesPipeline } from './translate-subtitles.ts';

/**
 * 字幕文件的翻译（架构设计 §7.9）：对着临时目录里的字幕文件与进程内的假文本 Provider（经真实的 `TextRunner` 与结构化输出
 * 校验）：条数与时间码不变、双语、换格式、术语表、输出不合时重发与失败后的重试、读不准的文件启动时拒绝、没有配置文本模型。
 * 授权、`pendingGrants` 与 Space 里的条目在 runtime-core 的端到端测试。
 */

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

/** n 条 SRT（CRLF、带 BOM）：第 3 条是空的，第 2 条两行带斜体。 */
function srt(n: number): string {
  const blocks: string[] = [];
  for (let i = 1; i <= n; i++) {
    const start = `00:00:${String(i).padStart(2, '0')},000`;
    const end = `00:00:${String(i).padStart(2, '0')},900`;
    const text = i === 3 ? '' : i === 2 ? '<i>Second</i> line\r\ncontinues' : `Hello number ${i}.`;
    blocks.push(`${i}\r\n${start} --> ${end}${text ? `\r\n${text}` : ''}`);
  }
  return `﻿${blocks.join('\r\n\r\n')}\r\n`;
}

const VTT = [
  'WEBVTT',
  '',
  'NOTE kept',
  '',
  'a',
  '00:01.000 --> 00:02.000 line:0',
  'Good morning',
  '',
  'b',
  '00:03.000 --> 00:04.500',
  'Use BaoCut today',
  '',
].join('\n');

class FakeText implements TextProvider {
  readonly id = 'fake';
  runs: TextRun[] = [];
  reply: (items: Array<{ id: string; text: string }>, run: TextRun) => string = (items) =>
    JSON.stringify({ translations: items.map((i) => ({ id: i.id, text: `译：${i.text}` })) });

  async generateText(run: TextRun, _signal: AbortSignal): Promise<TextReply> {
    this.runs.push(run);
    const user = run.parameters.messages.find((m) => m.role === 'user')!.content;
    const items = JSON.parse(user.split('<material>\n')[1]!.split('\n</material>')[0]!) as Array<{ id: string; text: string }>;
    return { text: this.reply(items, run), finishReason: 'stop', usage: null, modelVersion: 'writer-1', workerVersion: 'fake@1' };
  }
}

describe('字幕文件翻译的参数', () => {
  it('input 要是 .srt 或 .vtt 的绝对路径；与视频参数不能同时给', () => {
    expect(parseTranslateSubtitlesParams({ input: '/a/b.srt', targetLanguage: 'zh', bilingual: true, format: 'vtt' })).toEqual({
      input: '/a/b.srt',
      targetLanguage: 'zh',
      bilingual: true,
      format: 'vtt',
    });
    for (const bad of [
      { input: 'b.srt', targetLanguage: 'zh' },
      { input: '/a/b.ass', targetLanguage: 'zh' },
      { input: '/a/b.srt', targetLanguage: 'zh', videoId: 'vid_1' },
      { input: '/a/b.srt', targetLanguage: 'zh', bilingual: 'yes' },
      { input: '/a/b.srt', targetLanguage: 'zh', outDir: 'out' },
      { input: '/a/b.srt', targetLanguage: 'zh', format: 'ass' },
      { input: { entryId: 'ent_1' }, targetLanguage: 'zh' },
    ]) {
      expect(() => parseTranslateSubtitlesParams(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });
});

describe('字幕文件的翻译流程', () => {
  let dir: string;
  let files: string;
  let saved: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let text: FakeText;
  let configured: boolean;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-subtitles-'));
    files = path.join(dir, 'files');
    // 保存位置（§7.9）：还不存在，第一次写时创建。
    saved = path.join(dir, 'saved');
    await fs.mkdir(files);
    jobs = testJobManager(dir);
    await jobs.open();
    text = new FakeText();
    configured = true;
    const select = async (): Promise<TextSelection> => {
      if (!configured) {
        throw new RpcError('conflict', '没有配置文本生成', { code: 'CAPABILITY_NOT_CONFIGURED', capability: 'generateText' });
      }
      return {
        capability: 'generateText',
        providerId: 'fake',
        modelId: 'writer',
        kind: 'online',
        label: 'Fake',
        source: 'user-default',
        model: MODEL,
        text,
        defaults: { effort: null, concurrency: 4 },
      } as TextSelection;
    };
    const generator = createTextGenerator({ select, runner: new TextRunner({ concurrency: () => 4 }) });
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'staging'),
      definitions: [translateSubtitlesPipeline({ text: generator, selectText: select, hardLink: false, saveDirectory: () => saved })],
    });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, content: string | Buffer): Promise<string> {
    const file = path.join(files, name);
    await fs.writeFile(file, content);
    return file;
  }

  async function translate(params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start(
      { pipeline: 'translate-subtitles', params: { targetLanguage: 'zh-CN', ...params } },
      { kind: 'connection', id: 'conn_1' },
    );
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const stepJob = (record: JobRecord, name: string) => jobs.inspect(record.pipeline!.steps.find((s) => s.name === name)!.jobId!);

  it('逐批翻译：条数、序号与时间行不变，空条原样保留；写在保存位置，不覆盖已有的文件', async () => {
    const input = await write('movie.srt', srt(25));
    const record = await translate({ input });
    expect(record).toMatchObject({ state: 'completed', providerId: 'fake', modelId: 'writer', videoId: null });
    expect(record.pipeline!.steps.map((s) => [s.name, s.status])).toEqual([
      ['read', 'completed'],
      ['translate', 'completed'],
      ['check', 'completed'],
      ['publish', 'completed'],
    ]);
    // 24 条有文本，每批 20 条：两次调用；第二批带前文。
    expect(text.runs).toHaveLength(2);
    expect(text.runs[1]!.parameters.messages[1]!.content).toContain('"Hello number 20."');
    // 多行接成一句、去掉斜体再送模型。
    expect(text.runs[0]!.parameters.messages[1]!.content).toContain('"Second line continues"');

    expect(record.pipeline!.params).toMatchObject({ outDir: saved });
    const out = path.join(saved, 'movie.zh-CN.srt');
    const [source, translated] = [parseSubtitles(srt(25), 'srt'), parseSubtitles(await fs.readFile(out, 'utf8'), 'srt')];
    expect(translated.cues.map((c) => [c.id, c.timing])).toEqual(source.cues.map((c) => [c.id, c.timing]));
    expect(translated.cues[0]!.lines).toEqual(['译：Hello number 1.']);
    expect(translated.cues[1]!.lines).toEqual(['译：Second line continues']);
    expect(translated.cues[2]!.lines).toEqual([]);
    const bytes = await fs.readFile(out);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes('\r')).toBe(false);

    expect(record.result!.outputs).toEqual([
      {
        artifactId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        mediaType: 'application/x-subrip',
        byteLength: bytes.byteLength,
        assetId: null,
        media: { kind: 'text', entries: 25, durationSec: 25.9 },
        path: out,
        format: 'srt',
      },
    ]);
    expect(record.pipeline!.summary).toMatchObject({
      source: { path: input, format: 'srt', contentHash: expect.stringMatching(/^sha256:/) },
      file: out,
      cueCount: 25,
      translatedCount: 24,
      markupStripped: 1,
      bilingual: false,
      providerId: 'fake',
    });
    expect(stepJob(record, 'translate').warnings).toEqual([expect.objectContaining({ code: 'SUBTITLE_MARKUP_STRIPPED' })]);

    // 再来一次：不覆盖，加序号。
    const again = await translate({ input });
    expect(again.result!.outputs![0]!.path).toBe(path.join(saved, 'movie-2.zh-CN.srt'));
    expect(await fs.readFile(out, 'utf8')).toBe(bytes.toString('utf8'));
  });

  it('双语与换格式：VTT 转 SRT 每条原文在上、译文在下，cue settings 与 NOTE 丢掉并告警；输出到指定目录', async () => {
    const input = await write('talk.vtt', VTT);
    const outDir = path.join(dir, 'out');
    await fs.mkdir(outDir);
    const record = await translate({ input, bilingual: true, format: 'srt', outDir });
    expect(record.state).toBe('completed');
    const out = path.join(outDir, 'talk.zh-CN.bilingual.srt');
    expect(await fs.readFile(out, 'utf8')).toBe(
      [
        '1',
        '00:00:01,000 --> 00:00:02,000',
        'Good morning',
        '译：Good morning',
        '',
        '2',
        '00:00:03,000 --> 00:00:04,500',
        'Use BaoCut today',
        '译：Use BaoCut today',
        '',
      ].join('\n'),
    );
    expect(record.pipeline!.summary).toMatchObject({ format: 'srt', bilingual: true, droppedSettings: 1, droppedBlocks: 1 });
    expect(stepJob(record, 'check').warnings).toEqual([expect.objectContaining({ code: 'SUBTITLE_SETTINGS_DROPPED' })]);
  });

  it('VTT 到 VTT：标识、cue settings 与 NOTE 原样；术语表进提示词', async () => {
    const input = await write('talk.vtt', VTT);
    const record = await translate({ input, glossary: [{ source: 'BaoCut', target: '宝剪' }], sourceLanguage: 'en' });
    expect(record.state).toBe('completed');
    const out = await fs.readFile(path.join(saved, 'talk.zh-CN.vtt'), 'utf8');
    expect(out).toContain('NOTE kept\n\na\n00:01.000 --> 00:02.000 line:0\n译：Good morning');
    expect(text.runs[0]!.parameters.messages[0]!.content).toContain('- BaoCut → 宝剪');
    expect(record.pipeline!.summary).toMatchObject({ sourceLanguage: 'en', glossary: { terms: 1 } });
  });

  it('模型返回的条数不对：重发；一直不对时停在翻译这一步、不写文件，修好之后重试从翻译继续', async () => {
    const input = await write('movie.srt', srt(5));
    const normal = text.reply;
    text.reply = (items) => JSON.stringify({ translations: items.slice(1).map((i) => ({ id: i.id, text: 'x' })) });
    const record = await translate({ input });
    expect(record).toMatchObject({
      state: 'failed',
      error: { code: 'MODEL_OUTPUT_INVALID', details: { step: 'translate', reason: 'schema' } },
      pipeline: { stoppedAt: 'translate' },
    });
    expect(record.error!.message).toContain('条');
    expect(stepJob(record, 'translate').progress?.calls).toMatchObject({ calls: 3, retries: 2, failures: 1 });
    expect(await fs.readdir(files)).toEqual(['movie.srt']);
    expect(await fs.readdir(saved)).toEqual([]);

    text.reply = normal;
    await runner.retry(record.jobId);
    await jobs.settled(record.jobId);
    await runner.idle();
    const retried = jobs.inspect(record.jobId);
    expect(retried).toMatchObject({ state: 'completed', attempt: 2 });
    expect(retried.pipeline!.steps[0]).toEqual(record.pipeline!.steps[0]);
    expect(await fs.readdir(saved)).toEqual(['movie.zh-CN.srt']);
  });

  it('读不准、太大、找不到的文件与不能写的输出目录：启动就拒绝，不建任务', async () => {
    const start = (params: Record<string, unknown>) =>
      runner.start({ pipeline: 'translate-subtitles', params: { targetLanguage: 'en', ...params } }, { kind: 'connection', id: 'c' });
    const broken = await write('broken.srt', '1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:03,000 --> 00:00:04,000\nB\n');
    await expect(start({ input: broken })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'SUBTITLE_FILE_INVALID', line: 5 },
    });
    const empty = await write('empty.srt', '1\n00:00:01,000 --> 00:00:02,000\n');
    await expect(start({ input: empty })).rejects.toMatchObject({ details: { code: 'SUBTITLE_FILE_INVALID' } });
    const big = await write('big.srt', Buffer.alloc(4 * 1024 * 1024 + 1, 0x41));
    await expect(start({ input: big })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'SUBTITLE_FILE_TOO_LARGE', limit: 4 * 1024 * 1024 },
    });
    await expect(start({ input: path.join(files, 'missing.srt') })).rejects.toMatchObject({ code: 'not-found' });
    const good = await write('good.srt', srt(2));
    await expect(start({ input: good, outDir: path.join(good, 'nope') })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'OUTPUT_DESTINATION_UNAVAILABLE' },
    });
    expect(jobs.list()).toEqual([]);
  });

  it('没有配置文本模型：启动就以 CAPABILITY_NOT_CONFIGURED 拒绝，不建任务', async () => {
    configured = false;
    const input = await write('movie.srt', srt(2));
    await expect(
      runner.start({ pipeline: 'translate-subtitles', params: { input, targetLanguage: 'en' } }, { kind: 'connection', id: 'c' }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'CAPABILITY_NOT_CONFIGURED' } });
    expect(jobs.list()).toEqual([]);
  });
});
