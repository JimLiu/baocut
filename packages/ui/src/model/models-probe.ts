import {
  intlLocale,
  type GenerateImageRequest,
  type GenerateTextRequest,
  type GeneratedOutput,
  type ImageModelInfo,
  type JobRecord,
  type ModelInfoBase,
  type OnlineCapability,
  type SpeechModelInfo,
  type SynthesizeSpeechRequest,
  type TextJobResult,
} from '@baocut/protocol';
import { M } from './models-probe-copy.ts';
import { jobErrorText } from './localized-text.ts';

/**
 * 云端模型的「测试合成 / 测试生图 / 测试生成」（设计稿 settings-cloud.jsx 的测试对话框）：提交一个真实的生成任务，
 * 进度与结果走 `jobs` 主题；完成后读第一个产物给人听、给人看，文本读结果里的预览。任务也会出现在后台任务里——那是真的花了钱的一次调用。
 * 语音识别的测试要一段音频，`models.transcribe` 只认视频里的素材，独立测试还没有接口，这里不做。
 */

/** 测试合成的文字：当前界面语言的一句。 */
export const probeSpeechText = (): string => M.speechText;
/** 测试生图的提示词（设计稿 IMG_SAMPLE）。 */
export const PROBE_IMAGE_PROMPT = 'a paper crane on a wooden desk, soft morning light';

/** 测试文本生成的提示词（设计稿 settings-cloud.jsx:368「Reply with OK.」）。 */
export const PROBE_TEXT_PROMPT = 'Reply with OK.';

/** 这种能力在这一版能不能独立测试。 */
export function probeSupported(capability: OnlineCapability): boolean {
  return capability !== 'transcribe';
}

/** 模型没有预置音色、也没有默认音色（自建服务商没填音色 ID）时，测试要用户给一个音色 ID。 */
export function probeNeedsVoice(model: ModelInfoBase): boolean {
  const m = model as SpeechModelInfo;
  return Array.isArray(m.voices) && m.voices.length === 0 && m.defaultVoice === null;
}

/** 测试用的音色：给了就用给的，否则用模型的默认（再没有就取第一只预置）。 */
export function probeVoice(model: SpeechModelInfo, typed: string): string | undefined {
  return typed.trim() || model.defaultVoice || model.voices[0]?.voiceId || undefined;
}

/** 测试合成的请求：一句话、默认格式，不导入任何视频。 */
export function speechProbeRequest(providerId: string, model: SpeechModelInfo, typedVoice = ''): Omit<SynthesizeSpeechRequest, 'commandId'> {
  const voice = probeVoice(model, typedVoice);
  return { text: probeSpeechText(), provider: providerId, model: model.modelId, ...(voice ? { voice } : {}) };
}

/** 测试生图的请求：一张、模型的默认尺寸（不给尺寸，Codex 这类不接受尺寸的也能过），不导入任何视频。 */
export function imageProbeRequest(providerId: string, model: Pick<ImageModelInfo, 'modelId'>): Omit<GenerateImageRequest, 'commandId'> {
  return { prompt: PROBE_IMAGE_PROMPT, provider: providerId, model: model.modelId, count: 1 };
}

/** 本地生图「试画」的步数（设计稿 image-gen.jsx `ImageProbeDialog` 的本机分支：512² 一张、8 步）。 */
export const IMAGE_TRY_STEPS = 8;

/** 本地生图的「试画」：用户写的提示词、一张 512 × 512、8 步，`provider: 'local'`，`model` 是模型包 ID；不导入任何视频。 */
export function imageTryRequest(bundleId: string, prompt: string): Omit<GenerateImageRequest, 'commandId'> {
  return { prompt: prompt.trim(), provider: 'local', model: bundleId, size: '512x512', count: 1, steps: IMAGE_TRY_STEPS };
}

/**
 * 测试文本生成的请求：一条 user 消息，不给输出上限与推理强度（用模型的上限与模型页设的默认），不导入任何视频。
 * 结果和别的文本生成一样会列进 Space 的文档（runtime-core space/space-derive.ts）。
 */
export function textProbeRequest(providerId: string, model: Pick<ModelInfoBase, 'modelId'>): Omit<GenerateTextRequest, 'commandId'> {
  return { messages: [{ role: 'user', content: PROBE_TEXT_PROMPT }], provider: providerId, model: model.modelId };
}

/** 做完了的测试：生成语音、图片有产物（`output`）；文本是结果摘要（`text`），两者只有一个。 */
export type ProbeResult = { output: GeneratedOutput; text: null } | { output: null; text: TextJobResult };

export type ProbeState =
  | { status: 'ready' }
  | { status: 'submitting' }
  | { status: 'running'; jobId: string }
  | ({ status: 'done'; jobId: string; seconds: number | null } & ProbeResult)
  | { status: 'failed'; message: string; jobId?: string };

function elapsed(job: JobRecord): number | null {
  const start = job.startedAt ?? job.createdAt;
  if (!start || !job.endedAt) return null;
  const ms = Date.parse(job.endedAt) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null;
}

/** 任务记录 → 测试对话框的状态。还没在 `jobs` 主题里出现时仍算在跑。 */
export function probeFromJob(jobId: string, job: JobRecord | undefined): ProbeState {
  if (!job) return { status: 'running', jobId };
  switch (job.state) {
    case 'queued':
    case 'running':
      return { status: 'running', jobId };
    case 'completed': {
      const text = job.kind === 'generateText' ? job.result?.text : undefined;
      if (text) return { status: 'done', jobId, output: null, text, seconds: elapsed(job) };
      const output = job.result?.outputs?.[0];
      if (!output) return { status: 'failed', jobId, message: M.noResult };
      return { status: 'done', jobId, output, text: null, seconds: elapsed(job) };
    }
    case 'failed':
      return { status: 'failed', jobId, message: jobErrorText(job.error) ?? M.failed };
    case 'cancelled':
      return { status: 'failed', jobId, message: M.cancelled };
    case 'interrupted':
      return { status: 'failed', jobId, message: M.interrupted };
    case 'needs-reconciliation':
      return { status: 'failed', jobId, message: M.unknownOutcome };
  }
}

/** 结果的一行事实：音频写时长与采样率，图片写像素。 */
export function outputFacts(output: GeneratedOutput): string {
  const media = output.media;
  const type = output.mediaType.split('/')[1]?.toUpperCase() ?? output.mediaType;
  switch (media.kind) {
    case 'audio':
      return M.audioFacts(media.durationSec.toFixed(1), media.sampleRate / 1000, type);
    case 'image':
      return `${media.width} × ${media.height} · ${type}`;
    case 'video':
      return M.videoFacts(media.width, media.height, media.durationSec.toFixed(1), type);
    case 'text':
      return M.textFacts(media.entries, media.durationSec.toFixed(1), type);
    case 'package':
      return M.packageFacts(media.files, type);
    case 'project':
      return M.projectFacts(media.clips, media.durationSec.toFixed(1), type);
  }
}

/** 文本结果的一行事实：多少字、用了多少 token、到没到输出上限。 */
export function textProbeFacts(text: Pick<TextJobResult, 'length' | 'usage' | 'finishReason'>): string {
  const usage = text.usage;
  return [
    M.chars(text.length.toLocaleString(intlLocale())),
    usage && usage.inputTokens !== null ? M.inputTokens(usage.inputTokens.toLocaleString(intlLocale())) : null,
    usage && usage.outputTokens !== null ? M.outputTokens(usage.outputTokens.toLocaleString(intlLocale())) : null,
    text.finishReason === 'length' ? M.hitLimit : text.finishReason === 'content-filter' ? M.filtered : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 模型行上的判词（只记这次打开页面以来的测试）。 */
export function probeVerdict(state: ProbeState | undefined): { text: string; tone: 'neutral' | 'positive' | 'negative' } {
  if (!state || state.status === 'ready') return { text: M.untested, tone: 'neutral' };
  if (state.status === 'submitting' || state.status === 'running') return { text: M.testing, tone: 'neutral' };
  if (state.status === 'done') return { text: state.seconds !== null ? M.passedIn(state.seconds) : M.passed, tone: 'positive' };
  return { text: state.message, tone: 'negative' };
}
