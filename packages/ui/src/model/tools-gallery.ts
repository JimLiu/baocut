import {
  defineMessages,
  localizeText,
  type ModelCapabilitiesView,
  type ModelServiceCapability,
  type PipelineInfo,
  type ToolInputKind,
  type ToolProblem,
  type ToolStatus,
} from '@baocut/protocol';
import { cloudProviders } from './models-cloud.ts';
import type { ToolId } from './tool-catalog.ts';
import { zhHans } from './tools-gallery.zh-Hans.ts';
import { zhHant } from './tools-gallery.zh-Hant.ts';
import { ja } from './tools-gallery.ja.ts';
import { ko } from './tools-gallery.ko.ts';
import { es } from './tools-gallery.es.ts';
import { fr } from './tools-gallery.fr.ts';
import { de } from './tools-gallery.de.ts';
import { nl } from './tools-gallery.nl.ts';
import { ptBR } from './tools-gallery.pt-BR.ts';
import { it } from './tools-gallery.it.ts';
import { ru } from './tools-gallery.ru.ts';
import { pl } from './tools-gallery.pl.ts';
import { tr } from './tools-gallery.tr.ts';
import { vi } from './tools-gallery.vi.ts';

/** 工具卡现状行的文案（译文在 `tools-gallery.<语言>.ts`）。 */
const en = {
  transcode: 'Encoded on this computer with ffmpeg · nothing uploaded',
  linkReady: 'Download tool ready',
  pipelineMissing: 'This version of Runtime doesn’t have a pipeline for this tool yet, so it can’t be used for now',
  /** 原因后面接补救（两句都是 Runtime 给的，原因已去掉句末标点）。 */
  withRemedy: (message: string, remedy: string) => `${message}. ${remedy}`,
  localModels: (n: number) => `${n} local ${n === 1 ? 'model' : 'models'}`,
  cloudConnected: (n: number) => `${n} online ${n === 1 ? 'provider' : 'providers'} connected`,
  noSpeech: 'No speech synthesis model available yet',
  noImage: 'No image generation model available yet',
  noText: 'No text model available yet',
};
export type ToolsGalleryMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 工具总览（设计稿 page-tools.jsx `ToolsGallery`）：每张卡的一行现状。
 * 能不能用以 Runtime 的 `tools.list` 为准（不可用时写它给的第一条原因）；能用时用模型的三个工具按 `models` 主题的能力视图数本机模型与云端服务商，
 * 压缩与合并写在这台电脑上用 ffmpeg，从链接导入写下载工具就绪。
 */

/** 还没做成的工具与原因。现在没有：字幕翻译已经能翻一份字幕文件（`translate-subtitles` 流程）。 */
const PLANNED_REASON: Partial<Record<ToolId, string>> = {};

/** 压缩、合并与提取音频走 Runtime 的 `transcode` 流程，在这台电脑上用 ffmpeg 编码、不上传。 */
export function transcodeCardStatus(): string {
  return M.transcode;
}
/** 从链接导入能用（下载工具就绪）时的现状。 */
export function linkReadyStatus(): string {
  return M.linkReady;
}
/** 注册表列了工具，Runtime 却还没有执行它的流程（`pipelines.list` 里没有）：按不了。 */
export function pipelineMissing(): string {
  return M.pipelineMissing;
}

/** 还不能用的工具的原因；能用的为 null。 */
export function plannedReason(id: ToolId): string | null {
  return PLANNED_REASON[id] ?? null;
}

export interface ToolCardStatus {
  on: boolean;
  text: string;
}

/** 一条不可用原因给人看的那句：Runtime 的 `message`，要补救时接在后面。 */
export function problemText(problem: ToolProblem, withRemedy = false): string {
  // 原因与补救按界面当前语言重新生成（Runtime 的语言可能不同，或在切换语言之前读的）。
  const said = localizeText(problem.message, problem.messageRef);
  const remedy = problem.remedy ? localizeText(problem.remedy, problem.remedyRef) : '';
  if (!withRemedy || !remedy) return said;
  const message = said.replace(/[。.]$/, '');
  // 补救与原因是同一句（Runtime 把 CAPABILITY_NOT_CONFIGURED 的 hint 也当原因给）时只写一遍。
  if (message.includes(remedy.replace(/[。.]$/, ''))) return said;
  return M.withRemedy(message, remedy);
}

/**
 * 这个工具此刻为什么按不了（以 `tools.list` 为准）：不可用时第一条原因；执行它的流程（按输入种类，`executionByInput`）
 * 不在 `pipelines.list` 里时写 `pipelineMissing()`。能用、或状态还没到时 null。`pipelines` 为 null 时不判断流程。
 */
export function toolBlock(
  status: ToolStatus | null | undefined,
  pipelines: readonly PipelineInfo[] | null,
  input?: ToolInputKind,
  withRemedy = false,
): string | null {
  if (!status) return null;
  if (!status.available) return status.problems[0] ? problemText(status.problems[0], withRemedy) : M.pipelineMissing;
  const execution = (input && status.executionByInput?.[input]) || status.execution;
  if (pipelines && execution.kind === 'pipeline' && !pipelines.some((p) => p.name === execution.pipeline)) return M.pipelineMissing;
  return null;
}

/** 这种能力下能用的云端服务商有几家（连上了、这一档也可用；Codex 画图这类智能体 Provider 不算）。 */
export function usableCloudCount(view: ModelCapabilitiesView, capability: ModelServiceCapability): number {
  // 人声分离只在本机，没有云端服务商。
  if (capability === 'separateAudio') return 0;
  return cloudProviders(view, capability).filter((card) => card.connected && card.available).length;
}

/** 这种能力下装好、能用的本机模型有几只（`kind: 'local'` 的 Provider；文本生成没有本机模型）。 */
export function usableLocalCount(view: ModelCapabilitiesView, capability: ModelServiceCapability): number {
  return view[capability].providers
    .filter((p) => p.kind === 'local' && p.available)
    .reduce((n, p) => n + p.models.filter((m) => m.available !== false && !m.unavailableReason).length, 0);
}

/** 用模型的工具那一行：本机几只、云端几家；都没有时照 `none` 写、点变灰。 */
function modelStatus(view: ModelCapabilitiesView, capability: ModelServiceCapability, none: string): ToolCardStatus {
  const local = usableLocalCount(view, capability);
  const cloud = usableCloudCount(view, capability);
  const parts = [local ? M.localModels(local) : null, cloud ? M.cloudConnected(cloud) : null].filter(Boolean);
  return parts.length ? { on: true, text: parts.join(' · ') } : { on: false, text: none };
}

/**
 * 卡片的现状行；什么都说不出时 null。`block` 是 `toolBlock` 算出的不可用原因（`tools.list` 为准，Web 服务上的
 * `WEB_METHOD_NOT_ALLOWED`、`PATH_OUTSIDE_PROJECT` 也在这里）：给了就照写、点变灰；为 null 是确认能用，undefined 是状态还没到。
 */
export function toolCardStatus(id: ToolId, view: ModelCapabilitiesView | null, block?: string | null): ToolCardStatus | null {
  const planned = plannedReason(id);
  if (planned) return { on: false, text: planned };
  const transcode = id === 'compress-video' || id === 'merge-video' || id === 'extract-audio';
  if (block) return { on: false, text: block };
  if (transcode) return block === null ? { on: true, text: M.transcode } : null;
  if (id === 'link-import') return block === null ? { on: true, text: M.linkReady } : null;
  if (!view) return null;
  if (id === 'synthesize-speech') return modelStatus(view, 'synthesizeSpeech', M.noSpeech);
  if (id === 'generate-image') return modelStatus(view, 'generateImage', M.noImage);
  if (id === 'generate-text') return modelStatus(view, 'generateText', M.noText);
  return null;
}
