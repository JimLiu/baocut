import { defineMessages, localizeText, type ModelCapabilitiesView, type TranscribeModelInfo } from '@baocut/protocol';
import { LOCAL_PROVIDER } from './models-local.ts';
import { kindOfFileName } from './space.ts';
import { cloudModelOptions, initialModelKey, modelKeyOf, type ToolModelOption } from './tools-models.ts';
import { zhHans } from './tools-transcribe.zh-Hans.ts';
import { zhHant } from './tools-transcribe.zh-Hant.ts';
import { ja } from './tools-transcribe.ja.ts';
import { ko } from './tools-transcribe.ko.ts';
import { es } from './tools-transcribe.es.ts';
import { fr } from './tools-transcribe.fr.ts';
import { de } from './tools-transcribe.de.ts';
import { nl } from './tools-transcribe.nl.ts';
import { ptBR } from './tools-transcribe.pt-BR.ts';
import { it } from './tools-transcribe.it.ts';
import { ru } from './tools-transcribe.ru.ts';
import { pl } from './tools-transcribe.pl.ts';
import { tr } from './tools-transcribe.tr.ts';
import { vi } from './tools-transcribe.vi.ts';

/** 转录工具的文案（译文在 `tools-transcribe.<语言>.ts`）。 */
const en = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A',
  notInstalled: 'Not installed',
  notConnected: 'Not connected',
  noCloud: 'No online speech recognition service yet',
  cloudLine: (connected: boolean, provider: string) => `${connected ? 'Connected' : 'Not connected'} · ${provider} · transcribes online`,
  noLocal: 'No speech recognition model on this computer yet',
  localReady: 'Installed · recognizes on this computer',
  localMissing: 'Model not installed yet',
};
export type ToolsTranscribeMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 工具 › 转录（设计稿 tool-transcribe.jsx）的语音模型与文件判断：本机 / 在线、模型、语言，认不认这份文件。
 * 提交走 `transcribe` 流程（model/tool-runs.ts `transcribeParams`）：本机文件新建一个视频，或写进 Space 里的视频。
 */

export type TranscribeOption = ToolModelOption<TranscribeModelInfo>;
export type TranscribeMode = 'local' | 'cloud';

/** 拖放区下面那行支持的格式（设计稿原文）。 */
export function mediaFormats(): string {
  return M.mediaFormats;
}

/** 认不认这份文件：Space 分类里的视频或音频。 */
export function isTranscribable(fileName: string): boolean {
  const kind = kindOfFileName(fileName);
  return kind === 'video-file' || kind === 'audio';
}

/** 路径的最后一段。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** 本机的语音识别模型：`local` Provider 下的模型包；不可用的（没装好、停用）也列，标「未安装」。 */
function localOptions(view: ModelCapabilitiesView): TranscribeOption[] {
  return view.transcribe.providers
    .filter((p) => p.kind === 'local' || p.providerId === LOCAL_PROVIDER)
    .flatMap((p) =>
      p.models.map((info) => {
        const why = !p.available
          ? (localizeText(p.detail, p.detailRef) ?? M.notInstalled)
          : info.available === false
            ? (localizeText(info.detail, info.detailRef) ?? M.notInstalled)
            : null;
        return {
          key: modelKeyOf(p.providerId, info.modelId),
          providerId: p.providerId,
          provider: p.label,
          modelId: info.modelId,
          label: info.label || info.modelId,
          connected: true,
          usable: why === null,
          why,
          info,
        };
      }),
    );
}

/** 这种转录方式下的模型：本地是本机的模型包，云端是在线服务商的每只模型（没连上的也全列，标「未连接」）。 */
export function transcribeOptions(view: ModelCapabilitiesView, mode: TranscribeMode): TranscribeOption[] {
  return mode === 'local' ? localOptions(view) : cloudModelOptions(view, 'transcribe', true);
}

/** Picker 里的一项：云端带服务商名，不能用的带「未连接 / 未安装」（设计稿原文）。 */
export function transcribeOptionLabel(option: TranscribeOption, mode: TranscribeMode): string {
  const name = mode === 'cloud' ? `${option.provider} · ${option.label}` : option.label;
  if (option.usable) return name;
  return `${name} · ${mode === 'cloud' ? M.notConnected : M.notInstalled}`;
}

/** 进页时的方式与模型：生效的默认值在哪边就落在哪边，没有时本地优先。 */
export function initialTranscribe(view: ModelCapabilitiesView, saved: { mode: TranscribeMode; model: string | null } | null): {
  mode: TranscribeMode;
  model: string | null;
} {
  if (saved && transcribeOptions(view, saved.mode).some((o) => o.key === saved.model)) return saved;
  const effective = view.transcribe.effective;
  const local = transcribeOptions(view, 'local');
  const mode: TranscribeMode = effective
    ? local.some((o) => o.providerId === effective.providerId)
      ? 'local'
      : 'cloud'
    : local.some((o) => o.usable) || !transcribeOptions(view, 'cloud').some((o) => o.usable)
      ? 'local'
      : 'cloud';
  return { mode, model: initialModelKey(transcribeOptions(view, mode), null, effective) };
}

/** 换转录方式：落到这一边第一只能用的（没有时第一只），语言回到自动（设计稿 `switchMode`）。 */
export function switchMode(view: ModelCapabilitiesView, mode: TranscribeMode): { mode: TranscribeMode; model: string | null; language: string } {
  return { mode, model: initialModelKey(transcribeOptions(view, mode), null, view.transcribe.effective), language: '' };
}

/** 模型下面那句现状（设计稿原文）。 */
export function transcribeStatus(option: TranscribeOption | null, mode: TranscribeMode): string {
  if (mode === 'cloud') {
    if (!option) return M.noCloud;
    return M.cloudLine(option.usable, option.provider);
  }
  if (!option) return M.noLocal;
  return option.usable ? M.localReady : M.localMissing;
}
