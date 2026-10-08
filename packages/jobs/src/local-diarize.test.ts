import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE, ModelCatalog, ProviderFailure, type BundleDefinition } from '@baocut/models';
import { FAKE_MODEL_WORKER } from './index.ts';
import { LocalTranscribeProvider } from './local-provider.ts';

/**
 * 已有转写的说话人区分（架构设计 §6.6、Model Worker 协议规范 §2.5.5）：本地 Provider 的 `diarize()` 在假的 Model Worker
 * 里执行。模型包是测试用的「说话人区分」包（只带 `segmentation` 与 `speaker`）。
 */

const BUNDLE = 'spk@cpu';
const BUNDLES: BundleDefinition[] = [
  {
    bundleId: BUNDLE,
    capability: 'diarize',
    backend: 'candle',
    device: 'cpu',
    label: 'Speakers',
    components: {
      segmentation: { family: 'pyannote-segmentation', repo: 'test/seg', revision: 'r-seg' },
      speaker: { family: 'wespeaker', repo: 'test/spk', revision: 'r-spk' },
    },
  },
];

async function writeRepo(root: string, repo: string, revision: string): Promise<void> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const content = `weights of ${repo}`;
  await fs.writeFile(path.join(dir, 'model.safetensors'), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo, revision, files: [{ path: 'model.safetensors', size: content.length, sha256 }] }),
  );
}

describe('已有转写的说话人区分（假 Model Worker）', () => {
  let dir: string;
  let controlFile: string;
  let recordFile: string;
  let catalog: ModelCatalog;
  let provider: LocalTranscribeProvider;

  const control = (value: Record<string, unknown>) => fs.writeFile(controlFile, JSON.stringify({ record: recordFile, ...value }));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-local-diarize-'));
    controlFile = path.join(dir, 'control.json');
    recordFile = path.join(dir, 'runs.jsonl');
    await control({ capabilities: ['diarize'] });
    const models = path.join(dir, 'models');
    await writeRepo(models, 'test/seg', 'r-seg');
    await writeRepo(models, 'test/spk', 'r-spk');
    catalog = new ModelCatalog({ root: models, bundles: BUNDLES });
    provider = new LocalTranscribeProvider({
      catalog,
      command: () => ({ command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', controlFile] }),
      env: async () => process.env,
      idleMs: 60_000,
      cancelGraceMs: 5_000,
    });
  });

  afterEach(async () => {
    await provider.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('job.run（diarize）：词时间与刻度交给 Worker，输出是 staging 里的 speakers.json，进度按阶段', async () => {
    const input = path.join(dir, 'input.wav');
    await fs.writeFile(input, 'not really audio');
    const staging = path.join(dir, 'staging');
    await fs.mkdir(staging);
    const phases: string[] = [];
    const words: Array<[number, number]> = [
      [0, 400],
      [500, 900],
      [1000, 1400],
      [1500, 1900],
    ];
    const outcome = await provider.diarize(
      { bundleId: BUNDLE, jobId: 'job_1', input: { file: input, contentHash: 'sha256:00', track: 0 }, timescale: 1000, words, staging },
      new AbortController().signal,
      (_done, _total, phase) => phases.push(phase),
    );
    expect(outcome).toMatchObject({ outcome: 'completed', file: path.join(staging, 'speakers.json'), result: { speakers: 2 } });
    if (outcome.outcome !== 'completed') return;
    const body = JSON.parse(await fs.readFile(outcome.file, 'utf8')) as { words: string[] };
    expect(body.words).toEqual(['spk-1', 'spk-1', 'spk-2', 'spk-2']);
    expect(outcome.sha256).toBe(
      crypto
        .createHash('sha256')
        .update(await fs.readFile(outcome.file))
        .digest('hex'),
    );
    expect([...new Set(phases)]).toEqual(['decoding', 'diarizing', 'finalizing']);
    const run = JSON.parse((await fs.readFile(recordFile, 'utf8')).split('\n')[0]!) as Record<string, unknown>;
    expect(run).toMatchObject({
      capability: 'diarize',
      options: { timescale: 1000, words },
      staging,
      outputContract: 'baocut.speakers/v1',
    });
  });

  it('Worker 不声明 diarize：load-failed（capability-missing），模型包不停用', async () => {
    await control({ capabilities: ['transcribe'] });
    const error = await provider
      .diarize(
        {
          bundleId: BUNDLE,
          jobId: 'job_2',
          input: { file: path.join(dir, 'x.wav'), contentHash: 'sha256:00', track: 0 },
          timescale: 1000,
          words: [[0, 1]],
          staging: dir,
        },
        new AbortController().signal,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ kind: 'load-failed', details: { detail: 'capability-missing', family: 'pyannote-segmentation' } });
    expect(catalog.blocked(BUNDLE)).toBe(false);
  });
});
