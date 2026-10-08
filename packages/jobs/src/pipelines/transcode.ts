import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError, type GeneratedOutput, type TranscodeParams, type TranscodeSummary } from '@baocut/protocol';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { JobsTranscode } from '@baocut/protocol/messages/jobs/transcode.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { ffmpegVersion, probeMedia, runFfmpeg, type MediaToolResolver, type ProbedMedia } from './ffmpeg.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { transcodeDemand } from '../resource-profiles.ts';

/**
 * 文件转码（架构设计 §7.9）：文件到文件，不建视频，不经过视频的渲染管线，由 PATH 里的 ffmpeg 执行。
 *
 * 步骤：读取（ffprobe 每个输入；合并时决定流复制还是重新编码，提取音频时逐个决定）→ 编码（写进 staging，按 `-progress`
 * 报告秒数）→ 校验（ffprobe 读得出、有画面、编码与高度符合要求、时长在容差内；提取音频只看时长与音频轨）
 * → 发布（移到输出目录，不覆盖已有的文件）。
 * 输出记为没有视频的生成记录：`result.outputs` 的每一项带 `path`（输出文件的绝对路径），`artifactId` 是文件内容的摘要。
 */

export const TRANSCODE_PIPELINE = 'transcode';

export interface TranscodeDeps {
  ffmpeg: MediaToolResolver;
  ffprobe: MediaToolResolver;
  /**
   * 发布时先试硬链接（同一个文件系统上原子、不覆盖）；false 时直接走跨文件系统的办法：占住目标文件名，
   * 复制到同目录的临时文件，再改名覆盖占位。测试用。
   */
  hardLink?: boolean;
  /**
   * 不给 `outDir` 时的保存位置（§7.9「保存位置」，Runtime 按设置与主机决定）；提交时冻结进参数。没有接线时（只在单测里）
   * 写在源文件旁边。
   */
  saveDirectory?: () => string;
}

/** 冻结的参数：默认值已经补上。 */
export interface FrozenTranscodeParams extends TranscodeParams {
  codec: 'h264' | 'hevc';
  audioBitrateKbps: number;
}

/** 合并能流复制的编码：MP4 放得下，且各片段一致。 */
const COPYABLE_VIDEO = new Set(['h264', 'hevc']);
const COPYABLE_AUDIO = new Set(['aac', 'mp3', 'alac']);
const DEFAULT_CRF = { h264: 23, hevc: 28 } as const;
const MERGE_SAMPLE_RATE = 48000;

/**
 * 提取音频（§7.9）时能原样复制的音频编码与它们的容器；别的编码重新编码为 AAC 放进 `.m4a`。
 */
const AUDIO_CONTAINERS: Readonly<Record<string, { ext: string; mediaType: string }>> = {
  aac: { ext: '.m4a', mediaType: 'audio/mp4' },
  mp3: { ext: '.mp3', mediaType: 'audio/mpeg' },
  opus: { ext: '.ogg', mediaType: 'audio/ogg' },
  flac: { ext: '.flac', mediaType: 'audio/flac' },
};
const AAC_CONTAINER = AUDIO_CONTAINERS.aac!;

/** 一个输入的音轨怎样取出：流复制进对应的容器，或重新编码为 AAC（`reason` 说明原因）。 */
export interface AudioExtractDecision {
  copy: boolean;
  ext: string;
  mediaType: string;
  reason: string | null;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    inputs: {
      type: 'array',
      items: fileInputSchema('输入文件的绝对路径', 'Space 里的视频文件、成片或音频条目'),
      minItems: 1,
      maxItems: 100,
    },
    action: {
      type: 'string',
      enum: ['compress', 'merge', 'extract-audio'],
      description: 'compress：逐个压缩；merge：按顺序合并成一个文件；extract-audio：逐个取出音轨',
    },
    codec: { type: 'string', enum: ['h264', 'hevc'], default: 'h264' },
    maxHeight: { type: 'integer', minimum: 16, maximum: 8640, description: '画面高度的上限（像素）' },
    crf: { type: 'integer', minimum: 0, maximum: 51, description: '恒定质量；与 videoBitrateKbps 二选一' },
    videoBitrateKbps: { type: 'integer', minimum: 100, maximum: 200000 },
    audioBitrateKbps: { type: 'integer', minimum: 32, maximum: 1024, default: 128 },
    outDir: { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认主机的下载文件夹）' },
    // i18n-ignore-end
  },
  required: ['inputs', 'action'],
  additionalProperties: false,
};

interface ProbeOutput extends Record<string, unknown> {
  media: ProbedMedia[];
  /** 输入文件的大小与修改时间：重试时核对，变了就重新读取。 */
  stats: Array<{ size: number; mtimeMs: number }>;
  mode: TranscodeSummary['mode'];
  reason: string | null;
  /** 提取音频：每个输入的做法，与 `media` 一一对应。 */
  audio?: AudioExtractDecision[];
}

interface EncodeOutput extends Record<string, unknown> {
  /** staging 里的输出文件，以及各自对应的输入时长（合并时是总和）。 */
  files: Array<{ file: string; expectedSec: number; source: string }>;
  version: string;
  /** 命令摘要：输入与清单只留文件名；staging 里的输出留完整路径，完成时换成发布后的文件名。 */
  commands: string[][];
}

interface VerifyOutput extends Record<string, unknown> {
  media: Array<Extract<GeneratedOutput['media'], { kind: 'video' | 'audio' }>>;
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
}

export function transcodePipeline(deps: TranscodeDeps): PipelineDefinition<FrozenTranscodeParams> {
  return {
    name: TRANSCODE_PIPELINE,
    label: () => JobsTranscode.label(),
    description: () => JobsTranscode.description(),
    paramsSchema: PARAMS_SCHEMA,
    parse: parseTranscodeParams,
    async prepare(params) {
      for (const file of params.inputs) {
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile()) throw new RpcError('not-found', JobsTranscode.inputNotFound({ file }));
      }
      // 保存位置（§7.9）：给了用它，否则 Runtime 的保存位置；提交时冻结，不存在时创建，不能写入时拒绝。
      const outDir = params.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      let version: string;
      try {
        version = await ffmpegVersion(deps.ffmpeg);
      } catch (error) {
        if (error instanceof PipelineStepError) {
          const remedy = error.details?.remedy;
          throw new RpcError('conflict', error.message, { code: error.code, ...(typeof remedy === 'string' ? { remedy } : {}) });
        }
        throw error;
      }
      const stats = await Promise.all(params.inputs.map((f) => fs.stat(f)));
      const identity = params.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs }));
      return {
        params: outDir !== undefined ? { ...params, outDir } : params,
        providerId: 'ffmpeg',
        modelId: version,
        videoId: null,
        contentHash: `sha256:${sha256Hex(canonicalJson(identity))}`,
      };
    },
    steps: [
      {
        name: 'probe',
        label: () => JobsTranscode.stepProbe(),
        run: async ({ params, signal, progress }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const media: ProbedMedia[] = [];
          for (const file of params.inputs) {
            const probed = await probeMedia(deps.ffprobe, file, signal);
            if (params.action === 'extract-audio') {
              if (!probed.audio) throw new PipelineStepError('TRANSCODE_NO_AUDIO', JobsTranscode.noAudioTrack({ name: path.basename(file) }), { file });
            } else if (!probed.video) {
              throw new PipelineStepError('INPUT_UNREADABLE', JobsTranscode.noVideoTrack({ name: path.basename(file) }), { file });
            }
            media.push(probed);
            progress({ done: media.length, total: params.inputs.length, unit: 'units' });
          }
          const stats = await Promise.all(params.inputs.map(async (f) => fs.stat(f)));
          const audio = params.action === 'extract-audio' ? media.map((m) => extractAudioDecision(m.audio!)) : undefined;
          const decision =
            params.action === 'merge'
              ? mergeDecision(media)
              : audio
                ? extractAudioSummary(params.inputs, audio)
                : { mode: 're-encode' as const, reason: null };
          const output: ProbeOutput = {
            media,
            stats: stats.map((s) => ({ size: s.size, mtimeMs: s.mtimeMs })),
            mode: decision.mode,
            reason: decision.reason,
            ...(audio ? { audio } : {}),
          };
          return { output };
        },
        reusable: async (output, { params }) => {
          const recorded = (output as ProbeOutput).stats;
          for (const [i, file] of params.inputs.entries()) {
            const stat = await fs.stat(file).catch(() => null);
            if (!stat || stat.size !== recorded[i]?.size || stat.mtimeMs !== recorded[i]?.mtimeMs) return false;
          }
          return true;
        },
      },
      {
        name: 'encode',
        label: () => JobsTranscode.stepEncode(),
        // ffmpeg 的峰值需求（§7.7）：按输入的总大小估 staging。
        resources: (_params, outputs) => ({
          demand: transcodeDemand((outputs.probe as ProbeOutput).stats.reduce((sum, s) => sum + s.size, 0)),
        }),
        run: (context) => encode(deps, context),
        reusable: async (output) => {
          for (const { file } of (output as EncodeOutput).files) if (!(await fs.stat(file).catch(() => null))) return false;
          return true;
        },
      },
      {
        name: 'verify',
        label: () => JobsTranscode.stepVerify(),
        run: async ({ params, outputs, signal, progress }) => {
          const encoded = outputs.encode as EncodeOutput;
          progress(null, 'validating');
          const media: VerifyOutput['media'] = [];
          for (const item of encoded.files) {
            const probed = await probeMedia(deps.ffprobe, item.file, signal).catch((error: unknown) => {
              if (error instanceof PipelineStepError && error.code === 'INPUT_UNREADABLE') return null;
              throw error;
            });
            const problems =
              params.action === 'extract-audio'
                ? audioVerifyProblems(probed, item.expectedSec)
                : verifyProblems(probed, item.expectedSec, params, (outputs.probe as ProbeOutput).mode);
            if (problems.length > 0) {
              throw new PipelineStepError('EXPORT_VALIDATION_FAILED', JobsTranscode.verifyFailed({ name: path.basename(item.source) }), { problems });
            }
            if (params.action === 'extract-audio') {
              const audio = probed!.audio!;
              media.push({ kind: 'audio', durationSec: probed!.durationSec, sampleRate: audio.sampleRate, channels: audio.channels });
              continue;
            }
            media.push({
              kind: 'video',
              durationSec: probed!.durationSec,
              width: probed!.video!.width,
              height: probed!.video!.height,
              videoCodec: probed!.video!.codec,
              audioCodec: probed!.audio?.codec ?? null,
            });
          }
          return { output: { media } satisfies VerifyOutput };
        },
      },
      {
        name: 'publish',
        label: () => JobsTranscode.stepPublish(),
        run: async ({ params, outputs, signal, progress, jobId }) => {
          const encoded = outputs.encode as EncodeOutput;
          const verified = outputs.verify as VerifyOutput;
          progress(null, 'publishing');
          const published: GeneratedOutput[] = [];
          const audio = (outputs.probe as ProbeOutput).audio;
          if (params.outDir !== undefined) await ensureSaveDirectoryForStep(params.outDir);
          for (const [index, item] of encoded.files.entries()) {
            signal.throwIfAborted();
            const dir = params.outDir ?? path.dirname(item.source);
            const stem = path.parse(item.source).name;
            const { name, ext, mediaType } = outputName(params.action, stem, audio?.[index]);
            const file = await publishFile(item.file, dir, name, ext, jobId, deps.hardLink ?? true);
            const { size, digest } = await digestFile(file);
            published.push({
              artifactId: `sha256:${digest}`,
              mediaType,
              byteLength: size,
              assetId: null,
              media: verified.media[index]!,
              path: file,
            });
          }
          const output: PublishOutput = { outputs: published };
          return { output, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
        },
      },
    ],
    async complete({ params, outputs }) {
      const probed = outputs.probe as ProbeOutput;
      const encoded = outputs.encode as EncodeOutput;
      const published = (outputs.publish as PublishOutput).outputs;
      // 摘要里的输出用最终的文件名（发布时可能因重名加了序号），不用 staging 里的临时名字。
      const finalNames = new Map(encoded.files.map((f, i) => [f.file, path.basename(published[i]!.path!)]));
      const commands = encoded.commands.map((command) => command.map((arg) => finalNames.get(arg) ?? arg));
      const summary: TranscodeSummary = {
        action: params.action,
        mode: probed.mode,
        reason: probed.reason,
        executor: { tool: 'ffmpeg', version: encoded.version, commands },
        files: published.map((o) => o.path!),
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
    },
  };
}

export function parseTranscodeParams(raw: Record<string, unknown>): FrozenTranscodeParams {
  const reader = new ParamReader(raw, ['inputs', 'action', 'codec', 'maxHeight', 'crf', 'videoBitrateKbps', 'audioBitrateKbps', 'outDir']);
  const inputs = reader.array('inputs', { min: 1, max: 100 })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const action = reader.oneOf('action', ['compress', 'merge', 'extract-audio'] as const);
  if (!action) throw invalid('action', JobsTranscode.actionShape());
  if (action === 'merge' && inputs.length < 2) throw invalid('inputs', JobsTranscode.mergeNeedsTwo());
  const codec = reader.oneOf('codec', ['h264', 'hevc'] as const) ?? 'h264';
  const maxHeight = reader.int('maxHeight', 16, 8640);
  const crf = reader.int('crf', 0, 51);
  const videoBitrateKbps = reader.int('videoBitrateKbps', 100, 200000);
  if (crf !== undefined && videoBitrateKbps !== undefined) throw invalid('crf', JobsParams.onlyOneOf({ other: 'videoBitrateKbps' }));
  const audioBitrateKbps = reader.int('audioBitrateKbps', 32, 1024) ?? 128;
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  return {
    inputs: inputs as string[],
    action,
    codec,
    ...(maxHeight !== undefined ? { maxHeight } : {}),
    ...(videoBitrateKbps !== undefined ? { videoBitrateKbps } : { crf: crf ?? DEFAULT_CRF[codec] }),
    audioBitrateKbps,
    ...(outDir !== undefined ? { outDir } : {}),
  };
}

/**
 * 提取音频（§7.9）：AAC、MP3、Opus、FLAC 流复制进对应的容器；别的编码重新编码为 AAC（`.m4a`），并说明原因
 * （记进摘要：按当前语言生成的文字）。
 */
export function extractAudioDecision(audio: NonNullable<ProbedMedia['audio']>): AudioExtractDecision {
  const container = AUDIO_CONTAINERS[audio.codec];
  if (container) return { copy: true, ...container, reason: null };
  return { copy: false, ...AAC_CONTAINER, reason: JobsTranscode.audioReencode({ codec: audio.codec }).text };
}

/** 提取音频的总体做法：全部流复制时 `stream-copy`；有重新编码的，`reason` 逐个写明。 */
function extractAudioSummary(inputs: string[], decisions: AudioExtractDecision[]): { mode: TranscodeSummary['mode']; reason: string | null } {
  const reasons = decisions.flatMap((d, i) =>
    d.copy ? [] : [JobsTranscode.fileReason({ name: path.basename(inputs[i]!), reason: d.reason ?? '' }).text],
  );
  return reasons.length === 0
    ? { mode: 'stream-copy', reason: null }
    : { mode: 're-encode', reason: reasons.join(JobsTranscode.reasonSeparator().text) };
}

/**
 * 输出的文件名（不含序号）、扩展名与媒体类型：压缩 `<源文件名>-compressed.mp4`，合并 `<第一个源文件名>-merged.mp4`，
 * 提取音频 `<源文件名>` 加所选容器的扩展名。
 */
export function outputName(
  action: TranscodeParams['action'],
  stem: string,
  audio: AudioExtractDecision | undefined,
): { name: string; ext: string; mediaType: string } {
  if (action === 'extract-audio') {
    const container = audio ?? { ...AAC_CONTAINER };
    return { name: stem, ext: container.ext, mediaType: container.mediaType };
  }
  return { name: action === 'merge' ? `${stem}-merged` : `${stem}-compressed`, ext: '.mp4', mediaType: 'video/mp4' };
}

/** 合并时能不能流复制：各片段的编码、分辨率、帧率、像素格式、采样率与声道都一致，且编码放得进 MP4。`reason` 是按当前语言生成的文字。 */
export function mergeDecision(media: ProbedMedia[]): { mode: TranscodeSummary['mode']; reason: string | null } {
  const first = media[0]!;
  const differences: string[] = [];
  const fields: Array<[string, (m: ProbedMedia) => unknown]> = [
    [JobsTranscode.fieldVideoCodec().text, (m) => m.video?.codec],
    [JobsTranscode.fieldResolution().text, (m) => (m.video ? `${m.video.width}x${m.video.height}` : null)],
    [JobsTranscode.fieldFrameRate().text, (m) => m.video?.frameRate],
    [JobsTranscode.fieldPixelFormat().text, (m) => m.video?.pixFmt],
    [JobsTranscode.fieldAudioTrack().text, (m) => (m.audio ? JobsTranscode.present().text : null)],
    [JobsTranscode.fieldAudioCodec().text, (m) => m.audio?.codec ?? null],
    [JobsTranscode.fieldSampleRate().text, (m) => m.audio?.sampleRate ?? null],
    [JobsTranscode.fieldChannels().text, (m) => m.audio?.channels ?? null],
  ];
  const absent = JobsTranscode.absent().text;
  for (const [field, get] of fields) {
    const values = media.map(get);
    if (values.some((v) => v !== values[0])) {
      differences.push(JobsTranscode.fieldMismatch({ field, values: values.map((v) => String(v ?? absent)).join(' / ') }).text);
    }
  }
  if (differences.length > 0) return { mode: 're-encode', reason: differences.join(JobsTranscode.reasonSeparator().text) };
  if (!COPYABLE_VIDEO.has(first.video!.codec)) return { mode: 're-encode', reason: JobsTranscode.videoNotMp4({ codec: first.video!.codec }).text };
  if (first.audio && !COPYABLE_AUDIO.has(first.audio.codec)) {
    return { mode: 're-encode', reason: JobsTranscode.audioNotMp4({ codec: first.audio.codec }).text };
  }
  return { mode: 'stream-copy', reason: null };
}

async function encode(deps: TranscodeDeps, context: PipelineStepContext<FrozenTranscodeParams>): Promise<{ output: EncodeOutput }> {
  const { params, outputs, signal, staging, progress } = context;
  const probed = outputs.probe as ProbeOutput;
  const version = await ffmpegVersion(deps.ffmpeg);
  const total = probed.media.reduce((sum, m) => sum + m.durationSec, 0);
  const files: EncodeOutput['files'] = [];
  const commands: string[][] = [];
  const paths = new Set<string>(params.inputs);
  let base = 0;
  const report = (seconds: number) => progress({ done: Math.min(total, base + seconds), total, unit: 'seconds' }, 'encoding');
  report(0);

  const run = async (args: string[], out: string) => {
    commands.push(summarize(args, paths));
    try {
      await runFfmpeg(deps.ffmpeg, args, { signal, onTime: report });
    } catch (error) {
      await fs.rm(out, { force: true });
      throw error;
    }
  };

  if (params.action === 'extract-audio') {
    for (const [index, input] of params.inputs.entries()) {
      const decision = probed.audio![index]!;
      const out = path.join(staging, `audio-${index + 1}${decision.ext}`);
      await run(extractAudioArgs(params, input, decision, out), out);
      files.push({ file: out, expectedSec: probed.media[index]!.durationSec, source: input });
      base += probed.media[index]!.durationSec;
    }
  } else if (params.action === 'compress') {
    for (const [index, input] of params.inputs.entries()) {
      const out = path.join(staging, `compressed-${index + 1}.mp4`);
      await run(compressArgs(params, input, out), out);
      files.push({ file: out, expectedSec: probed.media[index]!.durationSec, source: input });
      base += probed.media[index]!.durationSec;
    }
  } else {
    const out = path.join(staging, 'merged.mp4');
    if (probed.mode === 'stream-copy') {
      const list = path.join(staging, 'concat.txt');
      await fs.writeFile(list, params.inputs.map((f) => `file '${f.replace(/'/g, `'\\''`)}'\n`).join(''));
      paths.add(list);
      await run(
        [
          '-hide_banner',
          '-v',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          list,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          ...TAIL,
          out,
        ],
        out,
      );
    } else {
      await run(mergeArgs(params, probed.media, out), out);
    }
    files.push({ file: out, expectedSec: total, source: params.inputs[0]! });
  }
  return { output: { files, version, commands } };
}

/** 进度写到标准输出，不写统计行；staging 里的输出可以覆盖（重试时）。 */
const TAIL = ['-progress', 'pipe:1', '-nostats', '-y'];

function videoCodecArgs(params: FrozenTranscodeParams): string[] {
  const codec = params.codec === 'hevc' ? ['-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : ['-c:v', 'libx264'];
  const rate = params.videoBitrateKbps !== undefined ? ['-b:v', `${params.videoBitrateKbps}k`] : ['-crf', String(params.crf)];
  return [...codec, '-preset', 'medium', ...rate, '-pix_fmt', 'yuv420p'];
}

function audioCodecArgs(params: FrozenTranscodeParams): string[] {
  return ['-c:a', 'aac', '-b:a', `${params.audioBitrateKbps}k`];
}

function compressArgs(params: FrozenTranscodeParams, input: string, out: string): string[] {
  // 高度取上限与原高的较小者，并取偶数（4:2:0 要求）；宽按比例取偶数。
  const height = params.maxHeight !== undefined ? `trunc(min(ih\\,${params.maxHeight})/2)*2` : 'trunc(ih/2)*2';
  return [
    '-hide_banner',
    '-v',
    'error',
    '-i',
    `file:${input}`,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `scale=-2:${height}`,
    ...videoCodecArgs(params),
    ...audioCodecArgs(params),
    '-movflags',
    '+faststart',
    ...TAIL,
    out,
  ];
}

/** 提取音频：只取第一条音轨，去掉画面、字幕与数据流；流复制或重新编码为 AAC。 */
function extractAudioArgs(params: FrozenTranscodeParams, input: string, decision: AudioExtractDecision, out: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    '-i',
    `file:${input}`,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    ...(decision.copy ? ['-c:a', 'copy'] : audioCodecArgs(params)),
    ...(decision.ext === '.m4a' ? ['-movflags', '+faststart'] : []),
    ...TAIL,
    out,
  ];
}

/** 重新编码的合并：各片段缩放、补边到第一个片段的画面（不超过高度上限），统一帧率、像素格式与音频，再拼接。 */
function mergeArgs(params: FrozenTranscodeParams, media: ProbedMedia[], out: string): string[] {
  const first = media[0]!.video!;
  const height = even(Math.min(first.height, params.maxHeight ?? first.height));
  const width = even((first.width * height) / first.height);
  const fps = first.frameRate && first.frameRate !== '0/0' ? first.frameRate : '30';
  const withAudio = media.some((m) => m.audio);
  const filters: string[] = [];
  const inputs: string[] = [];
  let pads = '';
  media.forEach((m, i) => {
    inputs.push('-i', `file:${params.inputs[i]!}`);
    filters.push(
      `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    );
    if (withAudio) {
      filters.push(
        m.audio
          ? `[${i}:a:0]aresample=${MERGE_SAMPLE_RATE},aformat=channel_layouts=stereo[a${i}]`
          : `anullsrc=r=${MERGE_SAMPLE_RATE}:cl=stereo,atrim=0:${m.durationSec.toFixed(3)}[a${i}]`,
      );
    }
    pads += withAudio ? `[v${i}][a${i}]` : `[v${i}]`;
  });
  filters.push(`${pads}concat=n=${media.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`);
  return [
    '-hide_banner',
    '-v',
    'error',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    ...(withAudio ? ['-map', '[a]'] : []),
    ...videoCodecArgs(params),
    ...(withAudio ? audioCodecArgs(params) : []),
    '-movflags',
    '+faststart',
    ...TAIL,
    out,
  ];
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** 参数摘要：输入与清单的路径只留文件名（输出的路径在完成时换成发布后的文件名）。 */
function summarize(args: string[], paths: Set<string>): string[] {
  return args.map((arg) => {
    const bare = arg.startsWith('file:') ? arg.slice(5) : arg;
    return paths.has(bare) ? path.basename(bare) : arg;
  });
}

/** 时长容差：0.5 秒或 2%，取大的。 */
export function durationTolerance(expectedSec: number): number {
  return Math.max(0.5, expectedSec * 0.02);
}

function verifyProblems(
  probed: ProbedMedia | null,
  expectedSec: number,
  params: FrozenTranscodeParams,
  mode: TranscodeSummary['mode'],
): string[] {
  if (!probed) return [JobsTranscode.probeOutputFailed().text];
  const problems: string[] = [];
  if (!probed.video) problems.push(JobsTranscode.outputNoVideo().text);
  if (Math.abs(probed.durationSec - expectedSec) > durationTolerance(expectedSec)) {
    problems.push(JobsTranscode.durationOff({ actual: probed.durationSec.toFixed(2), expected: expectedSec.toFixed(2) }).text);
  }
  if (probed.video && mode === 're-encode') {
    if (probed.video.codec !== params.codec) problems.push(JobsTranscode.codecMismatch({ actual: probed.video.codec, expected: params.codec }).text);
    if (params.maxHeight !== undefined && probed.video.height > params.maxHeight) {
      problems.push(JobsTranscode.heightOver({ height: probed.video.height, max: params.maxHeight }).text);
    }
  }
  return problems;
}

/** 提取音频的校验（§7.9）：只看时长与音频轨。 */
function audioVerifyProblems(probed: ProbedMedia | null, expectedSec: number): string[] {
  if (!probed) return [JobsTranscode.probeOutputFailed().text];
  const problems: string[] = [];
  if (!probed.audio) problems.push(JobsTranscode.outputNoAudio().text);
  if (Math.abs(probed.durationSec - expectedSec) > durationTolerance(expectedSec)) {
    problems.push(JobsTranscode.durationOff({ actual: probed.durationSec.toFixed(2), expected: expectedSec.toFixed(2) }).text);
  }
  return problems;
}

/**
 * 把 staging 里的文件发布到输出目录，不覆盖已有的文件：重名时依次加 `-2`、`-3`……
 * 同一个文件系统上用硬链接（原子、遇到已有的文件失败）；跨文件系统或不支持硬链接时，先以独占方式占住目标文件名，
 * 复制到同目录的临时文件，再改名覆盖占位，出错时删掉临时文件与占位。
 */
export async function publishFile(source: string, dir: string, stem: string, ext: string, tag: string, hardLink: boolean): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const target = path.join(dir, `${stem}${n === 1 ? '' : `-${n}`}${ext}`);
    if (hardLink) {
      try {
        await fs.link(source, target);
        return target;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') continue;
        if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EMLINK') throw error;
      }
    }
    let placeholder: fs.FileHandle;
    try {
      placeholder = await fs.open(target, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    await placeholder.close();
    const temp = path.join(dir, `.${stem}.${tag}.partial`);
    try {
      await fs.copyFile(source, temp);
      await fs.rename(temp, target);
      return target;
    } catch (error) {
      await fs.rm(temp, { force: true });
      await fs.rm(target, { force: true });
      throw error;
    }
  }
  throw new PipelineStepError('TRANSCODE_FAILED', JobsTranscode.tooManySameName({ name: `${stem}${ext}` }));
}

async function digestFile(file: string): Promise<{ size: number; digest: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, digest: hash.digest('hex') };
}
