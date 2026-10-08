import { defineMessages, intlLocale } from '@baocut/protocol';
import { zhHans } from './models-dir-copy.zh-Hans.ts';
import { zhHant } from './models-dir-copy.zh-Hant.ts';
import { ja } from './models-dir-copy.ja.ts';
import { ko } from './models-dir-copy.ko.ts';
import { es } from './models-dir-copy.es.ts';
import { fr } from './models-dir-copy.fr.ts';
import { de } from './models-dir-copy.de.ts';
import { nl } from './models-dir-copy.nl.ts';
import { ptBR } from './models-dir-copy.pt-BR.ts';
import { it } from './models-dir-copy.it.ts';
import { ru } from './models-dir-copy.ru.ts';
import { pl } from './models-dir-copy.pl.ts';
import { tr } from './models-dir-copy.tr.ts';
import { vi } from './models-dir-copy.vi.ts';

/** 设置 › 本地模型 › 模型目录的文案（英文是键与类型的来源，译文在 `models-dir-copy.<语言>.ts`）。 */

const and = (items: readonly string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(items);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const models = (n: number) => `${n} ${n === 1 ? 'model' : 'models'}`;

const en = {
  /** 卡片与对话框里的固定说法。 */
  dir: {
    title: 'Models folder',
    defaultChip: 'Default',
    envChip: 'Environment variable',
    change: 'Change…',
    restore: 'Restore default',
    envNote: 'Set by the BAOCUT_MODELS_DIR environment variable. To change it, edit the environment variable and restart BaoCut.',
    shareHint:
      "If other apps share this folder, deleting a model here deletes its files from the folder, and those apps won't find it either.",
    blockedPrefix: "Can't change right now:",
    viewTasks: 'View tasks',
    changeTitle: 'Change models folder',
    restoreTitle: 'Restore default location',
    restoreLead: 'Change the models folder back to',
    checking: 'Looking at this folder…',
    cancel: 'Cancel',
    howTo: 'What to do with existing models',
    moveOption: 'Move existing models there',
    switchOption: 'Only switch the location',
    confirmMove: 'Move and change',
    confirmSwitch: 'Change location',
    movingLabel: 'Moving models',
    stayOpen: "Don't quit BaoCut in the meantime",
    missingDir:
      "This folder doesn't exist (this also happens when an external drive isn't connected). Models work again once it's connected, or you can choose another location.",
    notWritableDir: "BaoCut doesn't have permission to write to this folder, so models can't be downloaded into it.",
    loading: 'Reading the models folder…',
    pickFailed: (message: string) => `Couldn't choose the folder: ${message}`,
    same: 'This is already the current models folder',
  },
  /** 卡片副题：已用 · 所在磁盘可用 · 已识别 N 个模型（可用空间查不到时 `free` 为 null）。 */
  stats: (used: string, free: string | null, count: number) =>
    [`${used} used`, ...(free !== null ? [`${free} free on disk`] : []), `${models(count)} found`].join(' · '),
  /** 现在不能更改：正在下载的、正在检查的模型名，在用本地模型的任务数。 */
  blocker: (downloading: readonly string[], testing: readonly string[], tasks: number) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`downloading ${and(downloading)}`);
    if (testing.length) parts.push(`checking ${and(testing)}`);
    if (tasks) parts.push(`${tasks} ${tasks === 1 ? 'task is' : 'tasks are'} using local models`);
    return `${capitalize(parts.join('; '))}. Wait for them to finish before changing, or files would be moved while in use.`;
  },
  missingTitle: "Can't find this folder",
  missingText: "This folder doesn't exist. This also happens when an external drive isn't connected; connect it and choose again.",
  notWritableTitle: "This folder isn't writable",
  notWritableText:
    "BaoCut doesn't have permission to write to this folder, so models can't be downloaded into it. Choose a writable location, or change its permissions first.",
  nestedTitle: "Can't put it here",
  nestedText:
    'The new location and the current models folder contain each other (one is inside the other). Choose a folder that is neither inside it nor contains it.',
  /** 新位置里有什么（`bytes` 已格式化）；`free` 是所在磁盘的可用空间，查不到时 null。 */
  found: (count: number, bytes: string, free: string | null) =>
    `${
      count
        ? `Found ${count} downloaded ${count === 1 ? 'model' : 'models'} (${bytes}), ready to use.`
        : 'There are no models in this folder yet. Models you download later will go here.'
    }${free !== null ? ` ${free} free on disk.` : ''}`,
  moveNoFit: (required: string, free: string, short: string) =>
    `Moving needs ${required}, but the target drive only has ${free} free (${short} short). It won't fit.`,
  moveSameVolume: (size: string) => `Moves ${size} on the same drive, so it's quick. The files won't be kept at the old location afterward.`,
  moveOther: (size: string) => `Moves ${size}. The files won't be kept at the old location afterward.`,
  /** 只切换位置：新位置里已有几个模型（0 表示不说个数）。 */
  switchDescription: (count: number) =>
    `Files at the old location are kept, not deleted. Only the ${count ? `${models(count)} ` : 'models '}already in the new location can be used; the rest show as not installed.`,
  appliedMoving: (where: string) => `Started moving models to ${where}`,
  appliedKept: (where: string) => `Models folder changed to ${where} · Files at the old location are kept`,
  applied: (where: string) => `Models folder changed to ${where}`,
  /** 移动进度；`to` 是缩短过的目标目录，`amount` 是「已移 / 总量」。 */
  moveWaiting: (to: string | null) => `Waiting to start moving${to ? ` to ${to}` : ''}…`,
  moveValidating: (amount: string | null) => `Verifying the copied files${amount ? ` (${amount})` : ''}…`,
  movePublishing: 'Finishing the move…',
  moving: (amount: string | null, to: string | null) => `Moving${amount ? ` ${amount}` : ''}${to ? ` to ${to}` : ''}…`,
};

export type ModelsDirMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
