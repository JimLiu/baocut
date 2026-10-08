import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import type { TextGenerateRequest, TextResult } from '@baocut/models';
import {
  cueProblems,
  resolveSpeechWorkerCommand,
  runSpeechTranslate,
  type SpeechTranslateInput,
  type SpeechWorkerNotice,
} from './speech-worker.ts';
import { translationShapeProblems } from './translation-document.ts';
import { fakeSpeechAnswer as fakeAnswer, requestedSentences, speechRequestKind as kindOf } from '../testing/fake-speech-model.ts';

// 真的 Speech Worker（`npm run build:engine` 构建；`BAOCUT_SPEECH_WORKER` 或引擎宿主旁边），模型是假的。没有构建时跳过。
const command = resolveSpeechWorkerCommand(process.env.BAOCUT_ENGINE_HOST ?? null);

/**
 * 界面核对译文的样例（`packages/ui/src/model/translation-doc.test.ts` 用）：一份转写与 Worker 对它写出的译文。这里用真的
 * Worker 重新翻译那份转写，确认样例就是 Worker 现在的输出；`BAOCUT_WRITE_FIXTURES=1` 时改为重写样例。
 */
const UI_SAMPLE = fileURLToPath(new URL('../../../ui/src/model/fixtures/worker-translation.json', import.meta.url));

const dirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** 一份英文转写：`sentences` 句，每句 `words` 个词，句末有标点，句间停顿 0.4 秒（微秒刻度）。 */
function speechInput(sentences: number, words: number): SpeechTranslateInput {
  const list = [];
  let clock = 0;
  for (let s = 0; s < sentences; s++) {
    for (let w = 0; w < words; w++) {
      const text = `${w === 0 ? '' : ' '}word${w}${w + 1 === words ? '.' : ''}`;
      list.push({ id: `w-${s}-${w}`, start: clock, end: clock + 280_000, text, speaker: 's1' });
      clock += 300_000;
    }
    clock += 400_000;
  }
  return {
    media: { assetId: 'asset-1', contentHash: 'sha256:00', duration: { ticks: String(clock + 1_000_000), timescale: 1_000_000 } },
    sourceLanguage: 'en',
    speechRef: { id: 'doc-speech', revision: 'rev-1' },
    sequenceId: 'seq-root',
    speech: {
      schema: 'baocut.speech/1',
      clock: 'source-asset',
      timescale: 1_000_000,
      speakers: [{ id: 's1', name: '说话人 1' }],
      words: list,
      sentences: null,
    },
    targetLanguage: 'zh-Hans',
    glossary: [{ source: 'word1', target: '词一' }],
    glossaryRef: null,
    params: { instructions: '口语化', backoffScale: 0 },
  };
}

interface Call {
  request: TextGenerateRequest;
  user: string;
}

/** 假的 `text.generate`：`hook` 可以在某次调用时抛错或改答案。 */
function fakeText(hook?: (call: Call, index: number, signal: AbortSignal | undefined) => Promise<string | null> | string | null) {
  const calls: Call[] = [];
  return {
    calls,
    async generate(request: TextGenerateRequest, options: { signal?: AbortSignal } = {}): Promise<TextResult> {
      const user = request.messages.find((m) => m.role === 'user')!.content;
      const call = { request, user };
      calls.push(call);
      const replaced = hook ? await hook(call, calls.length - 1, options.signal) : null;
      const text = replaced ?? fakeAnswer(user);
      return {
        providerId: request.provider!,
        modelId: request.model!,
        text: text === '\u0000length' ? '<article>' : text,
        finishReason: text === '\u0000length' ? 'length' : 'stop',
        usage: null,
        modelVersion: null,
        effort: { requested: null, applied: null },
        notes: [],
        workerVersion: 'fake',
      };
    },
  };
}

function run(
  staging: string,
  input: SpeechTranslateInput,
  text: ReturnType<typeof fakeText>,
  extra: { signal?: AbortSignal; notices?: SpeechWorkerNotice[]; progress?: unknown[] } = {},
) {
  return runSpeechTranslate({
    command: command!,
    staging,
    input,
    text,
    provider: 'fake',
    model: 'fake-model',
    modelInfo: { maxOutputTokens: 5_000, acceptsTemperature: false },
    signal: extra.signal ?? new AbortController().signal,
    progress: (progress) => extra.progress?.push(progress),
    onNotice: (notice) => extra.notices?.push(notice),
  });
}

describe('resolveSpeechWorkerCommand', () => {
  it('takes the environment first, then the sibling of the engine host', async () => {
    const dir = await tmp('speech-worker-lookup-');
    const exe = process.platform === 'win32' ? 'speech-worker.exe' : 'speech-worker';
    await fs.writeFile(path.join(dir, exe), '');
    const engineHost = path.join(dir, 'engine-host');
    expect(resolveSpeechWorkerCommand(engineHost, { BAOCUT_SPEECH_WORKER: '/opt/sw' })).toBe('/opt/sw');
    expect(resolveSpeechWorkerCommand(engineHost, {})).toBe(path.join(dir, exe));
  });
});

describe('cueProblems', () => {
  it('rejects overlapping, fractional and out-of-range cues', () => {
    const input = speechInput(1, 3);
    const cue = (start: number, end: number) => ({ unitId: 'u', sentenceId: 's', text: '好', start, end, fallback: false });
    const doc = (cues: unknown[]) => ({ schema: 'baocut.speech-worker.cues/1', language: 'zh-Hans', timescale: 1_000_000, cues });
    expect(cueProblems(doc([cue(0, 10), cue(10, 20)]), input)).toEqual([]);
    expect(cueProblems(doc([cue(0, 10), cue(5, 20)]), input)).toHaveLength(1);
    expect(cueProblems(doc([cue(0, 10.5)]), input)).toHaveLength(1);
    expect(cueProblems(doc([cue(0, 99_000_000)]), input)).toHaveLength(1);
  });
});

describe.skipIf(!command)('runSpeechTranslate with the Speech Worker', () => {
  it('relays every model call through text.generate and returns a §5.3 body with legal cues', async () => {
    const staging = await tmp('speech-worker-');
    const input = speechInput(4, 6);
    const text = fakeText();
    const progress: unknown[] = [];
    const result = await run(staging, input, text, { progress });

    expect(translationShapeProblems(result.translation, input.speechRef)).toEqual([]);
    expect(result.translation.language).toBe('zh-Hans');
    expect(result.translation.units).toHaveLength(4);
    expect(result.translation.units.every((unit) => unit.naturalText !== '')).toBe(true);
    expect(cueProblems(result.cues, input)).toEqual([]);
    expect(result.cues.cues.length).toBeGreaterThan(0);
    expect(result.report.unitCount).toBe(4);

    // 每次调用都经 text.generate：冻结的 Provider 与模型，按模型的限制去掉温度、夹输出上限。
    expect(text.calls.length).toBe(result.calls.calls);
    for (const { request } of text.calls) {
      expect(request).toMatchObject({ provider: 'fake', model: 'fake-model' });
      expect(request.temperature).toBeUndefined();
      expect(request.maxOutputTokens ?? 0).toBeLessThanOrEqual(5_000);
    }
    expect(progress.at(-1)).toMatchObject({ done: 4, total: 4, unit: 'units' });
  }, 60_000);

  it('lets the core retry a truncated answer', async () => {
    const staging = await tmp('speech-worker-');
    const input = speechInput(3, 5);
    const text = fakeText((_call, index) => (index === 0 ? '\u0000length' : null));
    const result = await run(staging, input, text);
    expect(result.translation.units).toHaveLength(3);
    expect(result.calls.calls).toBeGreaterThanOrEqual(2);
    expect(result.calls.failures).toBe(1);
  }, 60_000);

  it('rethrows a terminal error as is, keeps the checkpoint and does not redo finished pages on the next run', async () => {
    const staging = await tmp('speech-worker-');
    const input = speechInput(100, 12);
    const refusal = new RpcError('conflict', '授权的额度已经用完', { code: 'BUDGET_EXCEEDED', pendingGrants: [{ recipient: 'fake' }] });
    let translatePages = 0;
    const first = fakeText((call) => {
      if (kindOf(call.user) === 'translate' && ++translatePages === 2) throw refusal;
      return null;
    });
    await expect(run(staging, input, first)).rejects.toBe(refusal);
    await expect(fs.stat(path.join(staging, 'checkpoint.json'))).resolves.toBeTruthy();
    // 终止性的失败不重发。
    expect(first.calls.filter((call) => kindOf(call.user) === 'translate')).toHaveLength(2);
    const done = new Set(requestedSentences(first.calls.find((call) => kindOf(call.user) === 'translate')!.user));
    expect(done.size).toBeGreaterThan(0);

    const notices: SpeechWorkerNotice[] = [];
    const second = fakeText();
    const result = await run(staging, input, second, { notices });
    expect(notices.find((notice) => notice.event === 'resumed')).toMatchObject({ phase: 'translating', translatedSentences: done.size });
    const again = second.calls.filter((call) => kindOf(call.user) === 'translate').flatMap((call) => requestedSentences(call.user));
    expect(again.length).toBeGreaterThan(0);
    expect(again.filter((id) => done.has(id))).toEqual([]);
    expect(kindOf(second.calls[0]!.user)).toBe('translate');
    expect(result.translation.units).toHaveLength(100);
  }, 120_000);

  it('stops on abort, ends the worker and keeps the checkpoint', async () => {
    const staging = await tmp('speech-worker-');
    const input = speechInput(100, 12);
    const controller = new AbortController();
    let translatePages = 0;
    const text = fakeText(async (call, _index, signal) => {
      if (kindOf(call.user) === 'translate' && ++translatePages === 2) {
        controller.abort();
        signal?.throwIfAborted();
      }
      return null;
    });
    await expect(run(staging, input, text, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.stat(path.join(staging, 'checkpoint.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(staging, 'translation.json'))).rejects.toThrow();
  }, 120_000);

  it('writes exactly the translation the UI review sample holds', async () => {
    const sample = JSON.parse(await fs.readFile(UI_SAMPLE, 'utf8')) as { speech: { timescale: number }; translation: unknown };
    const input: SpeechTranslateInput = {
      ...speechInput(1, 1),
      media: {
        assetId: 'asset-1',
        contentHash: 'sha256:00',
        duration: { ticks: String(16 * sample.speech.timescale), timescale: sample.speech.timescale },
      },
      speech: sample.speech,
      glossary: [],
      params: { backoffScale: 0 },
    };
    const result = await run(await tmp('speech-worker-sample-'), input, fakeText());
    if (process.env.BAOCUT_WRITE_FIXTURES === '1') {
      await fs.writeFile(UI_SAMPLE, `${JSON.stringify({ speech: sample.speech, translation: result.translation }, null, 2)}\n`);
    }
    expect(result.translation).toEqual(sample.translation);
  }, 120_000);
});
