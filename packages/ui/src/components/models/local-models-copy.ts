import { defineMessages, live } from '@baocut/protocol';
import { zhHans } from './local-models-copy.zh-Hans.ts';
import { zhHant } from './local-models-copy.zh-Hant.ts';
import { ja } from './local-models-copy.ja.ts';
import { ko } from './local-models-copy.ko.ts';
import { es } from './local-models-copy.es.ts';
import { fr } from './local-models-copy.fr.ts';
import { de } from './local-models-copy.de.ts';
import { nl } from './local-models-copy.nl.ts';
import { ptBR } from './local-models-copy.pt-BR.ts';
import { it } from './local-models-copy.it.ts';
import { ru } from './local-models-copy.ru.ts';
import { pl } from './local-models-copy.pl.ts';
import { tr } from './local-models-copy.tr.ts';
import { vi } from './local-models-copy.vi.ts';

/**
 * 模型 › 本地模型的安装管理（下载、修复、停下、删除）用到的文字。页面其余的文字在 models-copy.ts 的 `LOCAL_COPY`，
 * 检查的说法在 model/model-check-copy.ts。英文是键与类型的来源，译文在 `local-models-copy.<语言>.ts`。
 */
const en = {
  install: {
    availableNote:
      'Before downloading, you’ll see how much will be downloaded and how much disk space is left. You can pause a download; what’s already downloaded is kept and resumes next time.',
    download: 'Download',
    complete: 'Complete',
    downloadSize: (size: string) => `Download ${size}`,
    completeSize: (size: string) => `Complete ${size}`,
    resume: 'Resume download',
    pause: 'Pause',
    cancelDownload: 'Cancel download',
    discard: 'Discard downloaded files',
    repair: 'Repair…',
    remove: 'Delete…',
    more: (id: string) => `More · ${id}`,
    details: 'Details',
    hideDetails: 'Hide details',
    componentLine: (state: 'installed' | 'missing', size: string | null) => (state === 'installed' ? `Installed${size ? ` · ${size}` : ''}` : `Missing${size ? ` · ${size}` : ''}`),
    sharedWith: (ids: string[]) => `Shared with ${ids.join(', ')}`,
    noComponents: 'This Runtime didn’t report component details.',
    // 确认对话框
    installTitle: (id: string) => `Download ${id}`,
    repairTitle: (id: string) => `Repair “${id}”?`,
    completeTitle: (id: string) => `Complete ${id}`,
    planning: 'Working out what to download…',
    verifying: 'Looking for damaged or missing files. This can take a while for large files…',
    planFailed: 'Couldn’t get the download plan',
    upToDate: 'All files are present and verified. Nothing to download.',
    completeNote: 'Only the missing components are downloaded; installed files are left alone.',
    repairUpToDate: 'All files are intact. Nothing to download again.',
    repairThenCheck: 'Only damaged or missing files are downloaded again; intact ones are left alone. It’s checked again automatically after the repair.',
    replanned: 'The download size just changed. Here’s the new plan; please confirm again.',
    source: (url: string) => `Download source: ${url}`,
    confirmInstall: (size: string) => `Download ${size}`,
    confirmRepair: 'Repair',
    cancel: 'Cancel',
    close: 'Close',
    started: (id: string) => `Downloading ${id} · progress shows in this row and in Background tasks`,
    // 停下与删除
    paused: (id: string) => `Paused ${id} · what’s already downloaded is kept`,
    discardTitle: (id: string) => `Discard the downloaded part of ${id}?`,
    discardBody: 'The next download starts from scratch. Files other model packages are downloading, and shared components, aren’t deleted.',
    discarded: (id: string) => `Discarded the downloaded part of ${id}`,
    removeTitle: (id: string) => `Delete ${id}?`,
    removeConfirm: 'Delete',
    stopFailed: (text: string) => `Couldn't stop: ${text}`,
    removeFailed: (text: string) => `Couldn't delete: ${text}`,
    installFailed: (text: string) => `The last download didn't finish: ${text}`,
  },
  shared: {
    title: 'Shared components',
    note: 'Several models in this category use these. Each is installed once and removed along with the last model that uses it.',
    /** 折叠时的副题：有要补的写几件待补，否则写一共几件。 */
    summaryRepair: (n: number) => (n === 1 ? '1 component to complete' : `${n} components to complete`),
    summaryCount: (n: number) => (n === 1 ? '1 shared component' : `${n} shared components`),
    /** 一行的副题：文件在盘上的模型几只在用、一共几只需要（总数至少 2）。 */
    usage: (live: number, all: number) => `${live === 1 ? '1 installed model uses it' : `${live} installed models use it`} · ${all} need it`,
    usageNone: (all: number) => `${all} models will use it · none installed yet`,
    /** 没有能借来补齐的模型：装模型时一起下载。 */
    withModel: (size: string | null) => `Downloads with the first model you install${size ? ` · ${size}` : ''}`,
    /** 从公共组件那一行补齐某只模型时，对话框里换掉 `install.completeNote` 的那一句。 */
    completeNote: (name: string) => `Shared components download with a model that uses them. This only adds what ${name} is missing; installed files are left alone.`,
  },
};

export type LocalModelsMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const LOCAL_INSTALL_COPY = live(() => M.install);

/** 本地模型页的「公共组件」区（设计稿 settings-local.jsx `SharedCard`）。 */
export const LOCAL_SHARED_COPY = live(() => M.shared);
