import { defineMessages } from '@baocut/protocol';
import { zhHans } from './download-source-copy.zh-Hans.ts';
import { zhHant } from './download-source-copy.zh-Hant.ts';
import { ja } from './download-source-copy.ja.ts';
import { ko } from './download-source-copy.ko.ts';
import { es } from './download-source-copy.es.ts';
import { fr } from './download-source-copy.fr.ts';
import { de } from './download-source-copy.de.ts';
import { nl } from './download-source-copy.nl.ts';
import { ptBR } from './download-source-copy.pt-BR.ts';
import { it } from './download-source-copy.it.ts';
import { ru } from './download-source-copy.ru.ts';
import { pl } from './download-source-copy.pl.ts';
import { tr } from './download-source-copy.tr.ts';
import { vi } from './download-source-copy.vi.ts';

/**
 * 下载来源的文案（英文是键与类型的来源，译文在 `download-source-copy.<语言>.ts`）。Hugging Face、ModelScope、GitHub 与网址是名字，
 * 不在文案里、不翻译。
 */
const en = {
  /** 本地模型页「下载与存储」里两个选择器的行名前缀与通用页的分组名都用各自的说法；这里是选择器的通用名。 */
  label: 'Download source',
  /** 本地模型页底部的折叠区。 */
  fold: 'Download and storage',
  kindModels: 'Model hub',
  kindTools: 'Tools and runtimes',
  kindModelsDesc: 'Model weights and most components download from here. A mirror must serve files at the same paths as Hugging Face.',
  kindToolsDesc:
    'External tools such as yt-dlp, plus files published on GitHub release pages, such as the LiteRT-LM runtime and the audio.cpp engine. A mirror serves files at <base>/<name>/<version>/<file>.',
  isDefault: 'Default',
  msHint: 'Often faster in mainland China',
  ghHint: 'Official release pages',
  mirrorHint: 'Mirror',
  hfDesc: 'Download from Hugging Face (huggingface.co).',
  msDesc: 'Download from ModelScope (modelscope.cn), often faster in mainland China.',
  ghDesc: 'Download from each project’s official GitHub release page.',
  modelsMirrorDesc: (base: string) => `Download from the mirror at ${base}.`,
  toolsMirrorDesc: (base: string) => `Download from the mirror at ${base}.`,
  msNote:
    'The few files ModelScope doesn’t have (whisper.cpp, GPT-SoVITS) still come from Hugging Face. Every file is checked against its built-in checksum.',
  envNote: (name: string) => `If the ${name} environment variable is set, it’s used instead.`,
  webNote: 'A browser can’t change download sources. Set them in the BaoCut desktop app.',
  lead:
    'You can keep several sources and pick one of each kind to use. The download dialog can switch it too, which changes the choice here. Every file is checked against its built-in checksum wherever it comes from.',
  editAria: (name: string) => `Edit “${name}”`,
  removeAria: (name: string) => `Remove “${name}”`,
  removeTitle: (name: string) => `Remove “${name}”?`,
  removeActiveBody: (kind: string, fallback: string) =>
    `It’s in use. Once it’s removed, ${kind} download from ${fallback} again. Files already downloaded aren’t affected.`,
  removeBody: 'This only removes the address from the list. Files already downloaded aren’t affected.',
  pickerLabel: (kind: string) => `Download source for ${kind}`,
  manage: 'Manage download sources…',
  addMirror: 'Add mirror',
  editMirror: 'Edit',
  removeMirror: 'Remove',
  nameLabel: 'Name (optional)',
  baseLabel: 'Base URL',
  addAndUse: 'Add and use',
  save: 'Save',
  cancel: 'Cancel',
  needBase: 'Enter the mirror’s base URL',
  duplicate: (name: string) => `Same address as “${name}”`,
  nameTooLong: (max: number) => `Name is too long (up to ${max} characters)`,
  tooMany: (max: number) => `You can add up to ${max} mirrors. Remove one first.`,
  changed: (kind: string, source: string) => `Downloads for ${kind} now come from ${source}`,
  added: (source: string) => `Added ${source} and switched to it`,
  updated: (source: string) => `Saved ${source}`,
  removed: (source: string) => `Removed ${source}`,
  fellBack: (source: string, fallback: string) => `Removed ${source}. Downloads come from ${fallback} again.`,
  // ---- 下载确认框 ----
  source: 'Source',
  groupDone: 'Already downloaded',
  partFrom: (source: string) => `from ${source}`,
  sequenceNote: 'The parts download one after another, and each is kept as soon as it finishes. If one fails, completing downloads only that part.',
  switchNote: 'Changing the source here also applies to later downloads.',
};
export type DownloadSourceMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
