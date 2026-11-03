import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkerFootprint } from '@baocut/models';
import { RpcError, SEPARATE_AUDIO_STEMS, type GeneratedOutput, type SeparateAudioParams, type SeparateAudioStems, type SeparateAudioSummary } from '@baocut/protocol';
import { JobsFootage as J } from '@baocut/protocol/messages/jobs/footage.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { localSeparateResources } from '../resource-profiles.ts';
import { stemProblems, type DubSeparator } from './dub.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { probeMedia, type MediaToolResolver, type ProbedMedia } from './ffmpeg.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { digestFile, publishFile } from './transcode.ts';

/**
 * 分轨（架构设计 §7.9）：把音视频文件的第一条音轨交给本机的分离模型（翻译配音的同一个 `DubSeparator`，§6.1 `separateAudio`），写成 WAV。
 * 文件到文件，不建视频、不动原文件。
 *
 * 步骤：读取（ffprobe，有音轨）→ 分离（逐个文件，模型包一次一个任务，同翻译配音的分离一步）→ 发布（`<源文件名>-<轨>.wav`，不覆盖已有的文件）。
 */

export const SEPARATE_AUDIO_PIPELINE = 'separate-audio';

export type StemName = keyof SeparateAudioSummary['items'][number]['files'];
const TWO_STEMS: readonly StemName[] = ['vocals', 'background'];
const FOUR_STEMS: readonly StemName[] = ['vocals', 'background', 'drums', 'bass', 'other'];

export interface SeparateAudioDeps {
  /** 选定分离模型（不给时按默认值）。没有可用的模型时抛 `CAPABILITY_NOT_CONFIGURED`。 */
  separator: (model?: { providerId: string; modelId: string }) => Promise<DubSeparator>;
  ffprobe: MediaToolResolver;
  saveDirectory?: () => string;
  hardLink?: boolean;
}

/** 冻结的参数：默认值与选定的模型已经补上。 */
export interface FrozenSeparateAudioParams extends SeparateAudioParams {
  stems: SeparateAudioStems;
  providerId: string;
  model: string;
  weightBytes: number | null;
  processPeak: WorkerFootprint | null;
}

interface ProbeOutput extends Record<string, unknown> {
  media: ProbedMedia[];
  stats: Array<{ size: number; mtimeMs: number }>;
}

interface SeparateOutput extends Record<string, unknown> {
  items: Array<{ source: string; durationSec: number; files: Partial<Record<StemName, string>> }>;
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
  /** 每个输入发布后的文件，按轨。 */
  published: Array<Partial<Record<StemName, string>>>;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    inputs: { type: 'array', items: fileInputSchema('输入文件的绝对路径', 'Space 里的音频、视频文件或成片'), minItems: 1, maxItems: 20 },
    stems: { type: 'string', enum: [...SEPARATE_AUDIO_STEMS], default: 'vocals', description: 'vocals：人声与伴奏；four：另出鼓、贝斯与其他' },
    model: { type: 'string', description: '分离模型包的 ID；不给时按默认值选' },
    outDir: { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置' },
    // i18n-ignore-end
  },
  required: ['inputs'],
  additionalProperties: false,
};

export function parseSeparateAudioParams(raw: Record<string, unknown>): SeparateAudioParams {
  const reader = new ParamReader(raw, ['inputs', 'stems', 'model', 'outDir', 'providerId', 'weightBytes', 'processPeak']);
  const inputs = reader.array('inputs', { min: 1, max: 20 })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const model = reader.string('model', { optional: true, max: 200 });
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  return {
    inputs: inputs as string[],
    stems: reader.oneOf('stems', SEPARATE_AUDIO_STEMS) ?? 'vocals',
    ...(model !== undefined ? { model } : {}),
    ...(outDir !== undefined ? { outDir } : {}),
  };
}

async function probeInput(ffprobe: MediaToolResolver, file: string, signal?: AbortSignal): Promise<ProbedMedia | { code: string; name: string }> {
  const name = path.basename(file);
  const media = await probeMedia(ffprobe, file, signal).catch((error: unknown) => {
    if (error instanceof PipelineStepError && error.code === 'INPUT_UNREADABLE') return null;
    throw error;
  });
  if (!media?.audio) return { code: 'AUDIO_NO_STREAM', name };
  return media;
}

const isMedia = (value: ProbedMedia | { code: string; name: string }): value is ProbedMedia => 'durationSec' in value;

export function separateAudioPipeline(deps: SeparateAudioDeps): PipelineDefinition<FrozenSeparateAudioParams, SeparateAudioParams> {
  return {
    name: SEPARATE_AUDIO_PIPELINE,
    label: () => J.separateLabel(),
    description: () => J.separateDescription(),
    paramsSchema: PARAMS_SCHEMA,
    parse: parseSeparateAudioParams,
    async prepare(params) {
      const separator = await deps.separator(params.model ? { providerId: 'local', modelId: params.model } : undefined);
      const stems = params.stems ?? 'vocals';
      if (stems === 'four' && !separator.fourStems) {
        throw new RpcError('invalid-request', J.separateStemsUnsupported({ model: separator.modelId }), { code: 'SEPARATION_STEMS_UNSUPPORTED', model: separator.modelId });
      }
      for (const file of params.inputs) {
        const media = await probeInput(deps.ffprobe, file);
        if (!isMedia(media)) throw new RpcError('invalid-request', J.separateNoAudio({ name: media.name }), { code: media.code, file });
      }
      const outDir = params.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      const stats = await Promise.all(params.inputs.map((file) => fs.stat(file)));
      const identity = {
        inputs: params.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs })),
        stems,
        model: separator.modelId,
      };
      return {
        params: {
          inputs: params.inputs,
          stems,
          providerId: separator.providerId,
          model: separator.modelId,
          weightBytes: separator.workerWeightBytes,
          processPeak: separator.processPeak ?? null,
          ...(outDir !== undefined ? { outDir } : {}),
        },
        providerId: separator.providerId,
        modelId: separator.modelId,
        videoId: null,
        contentHash: `sha256:${sha256Hex(canonicalJson(identity))}`,
      };
    },
    steps: [
      {
        name: 'probe',
        label: () => J.stepProbe(),
        run: async ({ params, progress, signal }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const media: ProbedMedia[] = [];
          for (const file of params.inputs) {
            const probed = await probeInput(deps.ffprobe, file, signal);
            if (!isMedia(probed)) throw new PipelineStepError(probed.code, J.separateNoAudio({ name: probed.name }), { file });
            media.push(probed);
            progress({ done: media.length, total: params.inputs.length, unit: 'units' });
          }
          const stats = await Promise.all(params.inputs.map((file) => fs.stat(file)));
          const output: ProbeOutput = { media, stats: stats.map((s) => ({ size: s.size, mtimeMs: s.mtimeMs })) };
          return { output };
        },
      },
      {
        name: 'separate',
        label: () => J.stepSeparate(),
        // 同翻译配音的分离一步：Worker 进程按模型包估计，这一步自己的是解出的音频与各轨输出；audio.cpp 的引擎进程只在这一步里活着。
        resources: (params) => localSeparateResources(params.model, params.weightBytes, params.processPeak),
        run: (context) => separateAll(deps, context),
        reusable: async (output) => {
          for (const item of (output as SeparateOutput).items) {
            for (const file of Object.values(item.files)) if (!(await fs.stat(file).catch(() => null))) return false;
          }
          return true;
        },
      },
      {
        name: 'publish',
        label: () => J.stepPublish(),
        run: async ({ params, outputs, signal, progress, jobId }) => {
          progress(null, 'publishing');
          const separated = outputs.separate as SeparateOutput;
          if (params.outDir !== undefined) await ensureSaveDirectoryForStep(params.outDir);
          const results: GeneratedOutput[] = [];
          const published: PublishOutput['published'] = [];
          for (const item of separated.items) {
            const dir = params.outDir ?? path.dirname(item.source);
            const files: Partial<Record<StemName, string>> = {};
            for (const [stem, file] of Object.entries(item.files) as Array<[StemName, string]>) {
              signal.throwIfAborted();
              const target = await publishFile(file, dir, `${path.parse(item.source).name}-${stem}`, '.wav', jobId, deps.hardLink ?? true);
              const media = await probeMedia(deps.ffprobe, target, signal);
              const { size, digest } = await digestFile(target);
              results.push({
                artifactId: `sha256:${digest}`,
                mediaType: 'audio/wav',
                byteLength: size,
                assetId: null,
                media: { kind: 'audio', durationSec: media.durationSec, sampleRate: media.audio?.sampleRate ?? 0, channels: media.audio?.channels ?? 0 },
                path: target,
              });
              files[stem] = target;
            }
            published.push(files);
          }
          const output: PublishOutput = { outputs: results, published };
          return { output, result: { documentId: null, artifactId: results[0]!.artifactId, outputs: results } };
        },
      },
    ],
    async complete({ params, outputs }) {
      const separated = outputs.separate as SeparateOutput;
      const { outputs: results, published } = outputs.publish as PublishOutput;
      const summary: SeparateAudioSummary = {
        stems: params.stems,
        executor: { providerId: params.providerId, modelId: params.model },
        items: separated.items.map((item, i) => ({ source: item.source, durationSec: item.durationSec, files: published[i]! })),
        files: results.map((o) => o.path!),
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: results[0]!.artifactId, outputs: results } };
    },
  };
}

async function separateAll(deps: SeparateAudioDeps, context: PipelineStepContext<FrozenSeparateAudioParams>): Promise<{ output: SeparateOutput }> {
  const { params, outputs, staging, jobId, signal, progress } = context;
  const separator = await deps.separator({ providerId: params.providerId, modelId: params.model });
  const probed = outputs.probe as ProbeOutput;
  const wanted = params.stems === 'four' ? FOUR_STEMS : TWO_STEMS;
  const items: SeparateOutput['items'] = [];
  progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'generating');
  for (const [index, source] of params.inputs.entries()) {
    const dir = path.join(staging, `separate-${index + 1}`);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const stems = await separator.separate({ file: source, staging: dir, jobId, signal, ...(params.stems === 'four' ? { allStems: true } : {}) });
    const files: Partial<Record<StemName, string>> = {};
    for (const stem of wanted) {
      const file = stems[stem];
      if (!file) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.verifyFailed({ name: path.basename(source) }), { stem });
      const media = await probeMedia(deps.ffprobe, file, signal);
      const problems = stemProblems(probed.media[index]!, { vocals: media, background: media });
      if (problems.length > 0) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.verifyFailed({ name: path.basename(source) }), { stem, problems });
      files[stem] = file;
    }
    items.push({ source, durationSec: probed.media[index]!.durationSec, files });
    progress({ done: index + 1, total: params.inputs.length, unit: 'units' });
  }
  return { output: { items } };
}
