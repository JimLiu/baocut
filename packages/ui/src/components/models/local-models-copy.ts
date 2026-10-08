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
    resume: 'Resume download',
    pause: 'Pause',
    cancelDownload: 'Cancel download',
    discard: 'Discard downloaded files',
    repair: 'Repair…',
    remove: 'Delete…',
    more: (id: string) => `More · ${id}`,
    details: 'Details',
    hideDetails: 'Hide details',
    componentLine: (state: 'installed' | 'missing', size: string | null) => (state === 'installed' ? `Installed${size ? ` · ${size}` : ''}` : 'Missing'),
    sharedWith: (ids: string[]) => `Shared with ${ids.join(', ')}`,
    noComponents: 'This Runtime didn’t report component details.',
    // 确认对话框
    installTitle: (id: string) => `Download ${id}`,
    repairTitle: (id: string) => `Repair “${id}”?`,
    planning: 'Working out what to download…',
    verifying: 'Looking for damaged or missing files. This can take a while for large files…',
    planFailed: 'Couldn’t get the download plan',
    upToDate: 'All files are present and verified. Nothing to download.',
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
};

export type LocalModelsMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const LOCAL_INSTALL_COPY = live(() => M.install);
