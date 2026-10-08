import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechSentences } from '@baocut/editor-wasm';
import { sha256File } from '@baocut/models';
import type { ModelBundleStatus } from '@baocut/protocol';
import { ArtifactStore } from '../artifact-store.ts';
import type { PipelineStepContext } from './pipeline.ts';
import {
  speakersApplyLabel,
  speakerApplyOperations,
  speakersPipeline,
  type FrozenSpeakersParams,
  type SpeakerProposalFile,
  type SpeakersDeps,
} from './speakers.ts';

/** 两句：「Hello there, how are you?」与「Fine.」，都是已有的说话人 a。 */
const TEXTS = ['Hello', 'there,', 'how', 'are', 'you?', 'Fine.'];
const speech = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  speakers: [{ id: 'a', name: '说话人 1' }],
  words: TEXTS.map((text, i) => ({ id: `w${i}`, start: i * 500, end: i * 500 + (i >= 2 && i < 5 ? 200 : 450), text, speaker: 'a' })),
  sentences: null,
};

function translation() {
  const { sentences, editViewHash } = speechSentences(speech);
  return {
    schema: 'baocut.translation/2',
    language: 'zh-Hans',
    sourceBasis: { speechRef: { id: 'doc_s', revision: '1' }, sequenceId: 'seq_1', scopeLineage: [], editViewHash },
    units: sentences.map((s, i) => ({
      id: `t-${s.id}`,
      sourceSentenceId: s.id,
      sourceFingerprint: s.fingerprint,
      naturalText: ['你好，你最近怎么样？', '还好。'][i],
      alignment: null,
      status: 'reviewed',
    })),
  };
}

const record = (id: string, kind: string, extra: Record<string, unknown> = {}, revision = '1') => ({
  id,
  kind,
  name: id,
  currentRevision: revision,
  revisions: {
    [revision]: {
      revision,
      contentHash: 'x',
      byteLength: 1,
      createdAt: '',
      createdBy: 'tx',
      summary: kind === 'speech' ? { words: 6, speakerCount: 1 } : { unitCount: 2, sourceRevision: '1' },
    },
  },
  ...extra,
});

const pack = (state: ModelBundleStatus['state']) => ({ bundleId: 'speaker-diarization@mlx', state }) as unknown as ModelBundleStatus;

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-speakers-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function setup(options: { pack?: ModelBundleStatus | null; labels?: Array<string | null>; translationBody?: unknown } = {}) {
  const documents: Record<string, ReturnType<typeof record>> = {
    doc_s: record('doc_s', 'speech', { sourceAssetId: 'asset_1' }),
    doc_t: record('doc_t', 'translation', { sourceDocumentId: 'doc_s', language: 'zh-Hans' }),
    doc_old: record('doc_old', 'translation', { sourceDocumentId: 'doc_s', language: 'en' }),
  };
  const bodies: Record<string, unknown> = {
    doc_s: speech,
    doc_t: options.translationBody ?? translation(),
    doc_old: { schema: 'baocut.translation/1', units: [] },
  };
  const runs: unknown[] = [];
  const deps: SpeakersDeps = {
    videos: {
      state: () => ({ revision: '9', rootSequenceId: 'seq_1', documents: documents as never }),
      document: async (_videoId, id) => ({ revision: documents[id]!.currentRevision, body: bodies[id] }),
      asset: () => ({ contentHash: 'sha256:media' }),
      apply: async () => ({}),
      assetFile: async () => ({ file: path.join(dir, 'media.wav'), revision: '1' }),
    },
    pack: async () => (options.pack === undefined ? pack('installed') : options.pack),
    footprint: async () => null,
    diarizer: {
      async diarize(run, _signal, onProgress) {
        runs.push(run);
        onProgress?.(1, 2, 'diarizing');
        const file = path.join(run.staging, 'speakers.json');
        const labels = options.labels ?? ['A', 'A', 'B', 'B', 'B', 'A'];
        await fs.writeFile(
          file,
          JSON.stringify({
            schema: 'baocut.speakers/v1',
            clock: 'source-asset',
            timescale: 1000,
            speakers: [],
            ranges: [],
            words: labels,
            provenance: {},
          }),
        );
        const sha256 = await sha256File(file);
        return {
          outcome: 'completed',
          file,
          sha256,
          workerVersion: 'test',
          result: { outcome: 'completed', output: null, speakers: 2, stats: { decodeMs: 1, diarizeMs: 9200 } },
        };
      },
    },
  };
  return { deps, documents, bodies, runs };
}

async function runAll(deps: SpeakersDeps) {
  const definition = speakersPipeline(deps);
  const prepared = await definition.prepare(definition.parse({ videoId: 'vid_1' }), {} as never);
  const params = prepared.params as FrozenSpeakersParams;
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
  const outputs: Record<string, Record<string, unknown>> = {};
  const staging = path.join(dir, 'staging');
  await fs.mkdir(staging, { recursive: true });
  for (const step of definition.steps) {
    const context = {
      params,
      parentJobId: 'job_p',
      jobId: `job_${step.name}`,
      attempt: 1,
      run: { runId: 'job_p', runGeneration: '1' },
      signal: new AbortController().signal,
      outputs,
      staging,
      artifacts,
      progress: () => {},
      warn: () => {},
    } as unknown as PipelineStepContext<FrozenSpeakersParams>;
    const result = await step.run(context);
    outputs[step.name] = result.output as Record<string, unknown>;
  }
  const done = await definition.complete!({ params, outputs, artifacts } as never);
  return { params, artifacts, done, proposalId: (outputs.propose as { artifactId: string }).artifactId };
}

describe('识别说话人的流程', () => {
  it('没有模型包或没装好时以 MODEL_UNAVAILABLE 拒绝，没装好的带上模型包状态（界面据此下载）', async () => {
    const missing = speakersPipeline(setup({ pack: null }).deps);
    await expect(missing.prepare({ videoId: 'vid_1' }, {} as never)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'MODEL_UNAVAILABLE' },
    });
    const absent = speakersPipeline(setup({ pack: pack('not-installed') }).deps);
    await expect(absent.prepare({ videoId: 'vid_1' }, {} as never)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'MODEL_UNAVAILABLE', bundle: { bundleId: 'speaker-diarization@mlx' } },
    });
  });

  it('冻结唯一的转写与它的版本，把词时间交给 Worker；提案复用已有说话人、新建一位，并试算译文重切', async () => {
    const { deps, runs } = setup();
    const { params, done } = await runAll(deps);
    expect(params).toMatchObject({ documentId: 'doc_s', revision: '1', assetId: 'asset_1', bundleId: 'speaker-diarization@mlx' });
    expect(runs[0]).toMatchObject({
      bundleId: 'speaker-diarization@mlx',
      input: { contentHash: 'sha256:media', track: 0 },
      timescale: 1000,
      words: [
        [0, 450],
        [500, 950],
        [1000, 1200],
        [1500, 1700],
        [2000, 2200],
        [2500, 2950],
      ],
    });
    expect(done.summary).toMatchObject({
      videoId: 'vid_1',
      source: { documentId: 'doc_s', revision: '1' },
      timescale: 1000,
      relabeled: 3,
      translationsSplit: 1,
      skippedTranslations: 1,
      bundleId: 'speaker-diarization@mlx',
      diarizeMs: 9200,
    });
    const speakers = (done.summary as { speakers: Array<{ id: string; name: string; isNew: boolean; sentences: number }> }).speakers;
    expect(speakers.map((s) => [s.id, s.name, s.isNew, s.sentences])).toEqual([
      ['a', '说话人 1', false, 2],
      ['spk-2', '说话人 2', true, 1],
    ]);
  });

  it('Worker 给的说话人与词数对不上时 MODEL_OUTPUT_INVALID', async () => {
    const { deps } = setup({ labels: ['A'] });
    await expect(runAll(deps)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
});

describe('应用识别说话人的提案', () => {
  async function proposal() {
    const fixture = setup();
    const { artifacts, proposalId } = await runAll(fixture.deps);
    const file = JSON.parse((await artifacts.read(proposalId))!.toString('utf8')) as SpeakerProposalFile;
    return { ...fixture, file };
  }

  it('转写与有变化的译文各写一个新版本：说话人改名、句子切开、译文重切不重译；概要更新说话人数', async () => {
    const { deps, file } = await proposal();
    const plan = await speakerApplyOperations(deps.videos, file, { 'spk-2': ' 嘉宾 ' });
    expect(plan.label).toBe(speakersApplyLabel());
    expect(plan.speakerCount).toBe(2);
    expect(plan.translationsSplit).toBe(1);
    expect(plan.operations.map((op) => [op.type, (op as { documentId?: string }).documentId])).toEqual([
      ['putDocument', 'doc_s'],
      ['putDocument', 'doc_t'],
    ]);
    const [speechOp, translationOp] = plan.operations as Array<{ body: Record<string, unknown>; summary?: unknown; kind: string }>;
    expect(speechOp!.kind).toBe('speech');
    expect(speechOp!.summary).toEqual({ words: 6, speakerCount: 2 });
    expect(speechOp!.body.speakers).toEqual([
      { id: 'a', name: '说话人 1' },
      { id: 'spk-2', name: '嘉宾' },
    ]);
    expect((speechOp!.body.words as Array<{ speaker: string }>).map((w) => w.speaker)).toEqual(['a', 'a', 'spk-2', 'spk-2', 'spk-2', 'a']);
    const units = translationOp!.body.units as Array<{ naturalText: string }>;
    expect(units).toHaveLength(3);
    expect(translationOp!.body.language).toBe('zh-Hans');
    expect(translationOp!.summary).toEqual({ unitCount: 3, sourceRevision: '1' });
  });

  it('文稿或译文在识别之后改过时 STALE_JOB_INPUT', async () => {
    const { deps, documents, file } = await proposal();
    documents.doc_t = record('doc_t', 'translation', { sourceDocumentId: 'doc_s' }, '2');
    await expect(speakerApplyOperations(deps.videos, file)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'STALE_JOB_INPUT' },
    });
    documents.doc_s = record('doc_s', 'speech', { sourceAssetId: 'asset_1' }, '2');
    await expect(speakerApplyOperations(deps.videos, file)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'STALE_JOB_INPUT', currentRevision: '2' },
    });
  });

  it('改名只认提案里的说话人，名字不能为空', async () => {
    const { deps, file } = await proposal();
    await expect(speakerApplyOperations(deps.videos, file, { ghost: '谁' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(speakerApplyOperations(deps.videos, file, { a: '  ' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(speakerApplyOperations(deps.videos, file, { a: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'invalid-request' });
  });
});
