import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tool-frame.zh-Hans.ts';
import { zhHant } from './tool-frame.zh-Hant.ts';
import { ja } from './tool-frame.ja.ts';
import { ko } from './tool-frame.ko.ts';
import { es } from './tool-frame.es.ts';
import { fr } from './tool-frame.fr.ts';
import { de } from './tool-frame.de.ts';
import { nl } from './tool-frame.nl.ts';
import { ptBR } from './tool-frame.pt-BR.ts';
import { it } from './tool-frame.it.ts';
import { ru } from './tool-frame.ru.ts';
import { pl } from './tool-frame.pl.ts';
import { tr } from './tool-frame.tr.ts';
import { vi } from './tool-frame.vi.ts';
import { localNotDownloaded, type ToolModelOption } from './tools-models.ts';

/** 模型一行的文案（译文在 `tool-frame.<语言>.ts`）。`noun` 是这种模型的叫法，由调用方按当前语言给。 */
const en = {
  noneAvailable: (noun: string) => `No ${noun} available yet; set one up in Settings`,
  pickOne: (noun: string) => `Choose a ${noun} first`,
  notInstalled: (name: string) => `${name} isn’t installed yet`,
  notConnected: (provider: string) => `${provider} isn’t connected yet`,
  unavailable: (name: string, why: string | null) => `${name} · ${why ?? 'Unavailable'}`,
  notInstalledWarning: (name: string) => `${name} isn’t installed yet. Choose an installed one, or download it in Settings`,
  notConnectedWarning: (provider: string) => `${provider} isn’t connected yet. Choose one that works, or connect it in Settings`,
  noModel: (noun: string, local: boolean) =>
    local
      ? `No ${noun} available yet. Install a local model or connect a cloud service in Settings.`
      : `No ${noun} available yet. Connect a cloud service in Settings.`,
};
export type ToolFrameMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 工具页的统一骨架（产品设计 §2.7；设计稿 tool-frame.jsx）：输入 → 模型 → 选项 → 保存位置 → 开始。
 * 这里是「模型」一行的纯逻辑：没有可用模型、选中的还没装或没连上时，这一行怎么说、主按钮旁写哪条原因。
 * 不整页挡住：页面照常能填，只是开始按钮按不了并说明原因。
 */

/** 选中的这只给人看的名字：本机写模型的名字，云端写服务商。 */
function nameOf<M>(o: ToolModelOption<M>): string {
  return o.local ? o.label : o.provider;
}

/** 主按钮旁那条原因（设计稿 `modelReason`）；能用时 null。`noun` 是这种模型的叫法（「语音合成模型」）。 */
export function modelReason<M>(options: readonly ToolModelOption<M>[], selected: ToolModelOption<M> | null, noun: string): string | null {
  if (!options.length) return M.noneAvailable(noun);
  if (!selected) return M.pickOne(noun);
  if (selected.usable) return null;
  if (selected.local) return selected.why === localNotDownloaded() ? M.notInstalled(selected.label) : M.unavailable(selected.label, selected.why ?? null);
  if (!selected.connected) return M.notConnected(selected.provider);
  return M.unavailable(selected.provider, selected.why ?? null);
}

/** 模型一行下面的提醒（设计稿 `ToolModelRow` 的警示）：选中的能用时 null。 */
export function modelWarning<M>(selected: ToolModelOption<M> | null): string | null {
  if (!selected || selected.usable) return null;
  if (selected.local && selected.why === localNotDownloaded()) return M.notInstalledWarning(selected.label);
  if (!selected.local && !selected.connected) return M.notConnectedWarning(selected.provider);
  return M.unavailable(nameOf(selected), selected.why ?? null);
}

/** 一只可用的都没有时那一行（设计稿 `ToolModelRow` 的空态）。`local` 为这种能力有没有本机模型（文本生成没有）。 */
export function noModelText(noun: string, local = true): string {
  return M.noModel(noun, local);
}

// ---- 保存位置 ----

/**
 * 保存位置的显示名（设计稿 model-tool-save-dir.js `label`）：家目录缩成 `~`，多于三级时只留最后两级、中间写「…」。
 * Windows 路径的反斜杠照原样留着。
 */
export function saveDirLabel(path: string): string {
  const p = path
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^([A-Za-z]:)\\Users\\[^\\]+/, '~')
    .replace(/[\\/]+$/, '');
  if (!p) return path;
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const parts = p.split(sep);
  return parts.length > 3 ? `${parts[0]}${sep}…${sep}${parts.slice(-2).join(sep)}` : p;
}

/**
 * 这次运行交给 Runtime 的目录（直接任务的 `saveDir`、固定流程的 `outDir`）：「更改…」选过的优先，否则 `tools.list` 给的保存位置；
 * 都没有（Web 服务不给保存位置）时不给，由 Runtime 用它自己的缺省（直接任务不写副本，流程写到保存位置）。
 */
export function saveTarget(saveDirectory: string | null, override: string | null): string | undefined {
  return override?.trim() || saveDirectory || undefined;
}

/** 直接任务的请求带上 `saveDir`（有目录时）。 */
export function withSaveDir<T extends object>(request: T, saveDir: string | undefined): T & { saveDir?: string } {
  return saveDir ? { ...request, saveDir } : request;
}
