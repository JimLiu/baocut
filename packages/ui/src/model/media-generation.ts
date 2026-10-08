import { defineMessages, type GenerateImageRequest, type Id, type ImageModelInfo, type JobRecord, type SynthesizeSpeechRequest } from '@baocut/protocol';
import { zhHans } from './media-generation.zh-Hans.ts';
import { zhHant } from './media-generation.zh-Hant.ts';
import { ja } from './media-generation.ja.ts';
import { ko } from './media-generation.ko.ts';
import { es } from './media-generation.es.ts';
import { fr } from './media-generation.fr.ts';
import { de } from './media-generation.de.ts';
import { nl } from './media-generation.nl.ts';
import { ptBR } from './media-generation.pt-BR.ts';
import { it } from './media-generation.it.ts';
import { ru } from './media-generation.ru.ts';
import { pl } from './media-generation.pl.ts';
import { tr } from './media-generation.tr.ts';
import { vi } from './media-generation.vi.ts';
import { aspectOptions, imageRequest, type AspectOption, type ImageDraft, type ImageOption } from './tools-image.ts';
import { didNotFinish } from './tools-records.ts';
import { jobLive } from './task-list.ts';
import { speechRequest, type SpeechOption, type TtsDraft } from './tools-tts.ts';

/**
 * 编辑器右侧「音频 › 生成语音 / 克隆声音」与「图片 › AI 生成」（设计稿 panel-tts.jsx、panel-image-gen.jsx）：
 * 与工具页同一套表单与请求，只多带 `videoId`。按合同，带 `videoId` 的生成任务做完由 Runtime 把结果导入成这个视频的素材
 * （`result.outputs[i].assetId`，来源记 `generated`），但不放上时间线——放上去仍是另一步（`placeAsset`）。
 */

// ---- 请求 ----

/** 这一块的文案（英文是键与类型的来源，译文在 `media-generation.<语言>.ts`）。 */
const en = {
  /** 生成语音导入成素材时的名字：文字的开头（`head`，截断时已带省略号）。 */
  speechAssetName: (head: string) => `Speech: ${head}`,
};

export type MediaGenerationMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 生成语音导入成素材时的名字：「语音：」加文字的开头（与 Runtime 的默认名同样截 24 字）。 */
export function speechAssetName(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return M.speechAssetName(`${chars.slice(0, 24).join('')}${chars.length > 24 ? '…' : ''}`);
}

export function editorSpeechRequest(draft: TtsDraft, option: SpeechOption, videoId: Id): Omit<SynthesizeSpeechRequest, 'commandId'> {
  const request = speechRequest(draft, option);
  return { ...request, videoId, name: speechAssetName(request.text) };
}

/** 编辑器里的生图草稿：多一颗「跟视频画布」（设计稿 `fit`）。 */
export interface EditorImageDraft extends ImageDraft {
  /** 画幅跟着视频画布走：选这颗时 `size` 不用，按画布取最接近的那一档。 */
  fit: boolean;
}

/** 画布最接近哪一档画幅（按宽高比的对数距离）；这只模型不让选尺寸时 null。 */
export function canvasAspect(canvas: { width: number; height: number }, options: readonly AspectOption[]): AspectOption | null {
  if (!options.length || canvas.width <= 0 || canvas.height <= 0) return null;
  const target = Math.log(canvas.width / canvas.height);
  let best = options[0]!;
  for (const o of options) if (Math.abs(Math.log(o.ratio) - target) < Math.abs(Math.log(best.ratio) - target)) best = o;
  return best;
}

/** 「跟视频画布」那一档（没有可选画幅时 null）。 */
export function fittedAspect(info: Pick<ImageModelInfo, 'aspectRatios' | 'sizes'>, canvas: { width: number; height: number }): AspectOption | null {
  return canvasAspect(canvas, aspectOptions(info));
}

/** 实际交出去的草稿：选了「跟视频画布」时画幅换成画布那一档。 */
export function effectiveImageDraft(draft: EditorImageDraft, info: ImageModelInfo, canvas: { width: number; height: number }): ImageDraft {
  const fitted = draft.fit ? fittedAspect(info, canvas) : null;
  return fitted ? { ...draft, size: fitted.key } : draft;
}

export function editorImageRequest(
  draft: EditorImageDraft,
  option: ImageOption,
  videoId: Id,
  canvas: { width: number; height: number },
): Omit<GenerateImageRequest, 'commandId'> {
  return { ...imageRequest(effectiveImageDraft(draft, option.info, canvas), option), videoId };
}

/** 重试也要回到这个视频：工具页的「照冻结参数再提交」不带 `videoId`，这里补上。 */
export function withVideo<R extends object>(request: R | null, videoId: Id): (R & { videoId: Id }) | null {
  return request ? { ...request, videoId } : null;
}

// ---- 记录 ----

/** 这个视频里这一类生成任务，新的在前；本机藏起来的不列。不限提交者：Agent 在这个视频里生的也在。 */
export function videoGenerationJobs(jobs: readonly JobRecord[], videoId: Id, kind: 'synthesizeSpeech' | 'generateImage', hidden: readonly Id[]): JobRecord[] {
  const skip = new Set(hidden);
  return jobs
    .filter((job) => job.kind === kind && job.videoId === videoId && !skip.has(job.jobId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 一条生成结果导入成的素材（导入失败或还没导入时 null）。 */
export function outputAsset(job: Pick<JobRecord, 'result'>, artifactId: string): Id | null {
  return job.result?.outputs?.find((o) => o.artifactId === artifactId)?.assetId ?? null;
}

/**
 * 生成语音子页走到哪一步（设计稿 `phase`）：还没提交是 setup；排队、在跑或刚提交还没出现在任务镜像里是 run；
 * 做完是 done；没做成（失败、中断、结果不明）是 failed；取消了回到 setup。
 */
export type TtsStage = 'setup' | 'run' | 'done' | 'failed';

export function ttsStage(jobId: Id | null, job: JobRecord | null): TtsStage {
  if (!jobId) return 'setup';
  if (!job) return 'run';
  if (jobLive(job)) return 'run';
  if (job.state === 'completed') return 'done';
  if (didNotFinish(job)) return 'failed';
  return 'setup';
}
