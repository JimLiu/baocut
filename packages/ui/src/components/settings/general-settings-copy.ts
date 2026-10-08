import { defineMessages } from '@baocut/protocol';
import { zhHans } from './general-settings-copy.zh-Hans.ts';
import { zhHant } from './general-settings-copy.zh-Hant.ts';
import { ja } from './general-settings-copy.ja.ts';
import { ko } from './general-settings-copy.ko.ts';
import { es } from './general-settings-copy.es.ts';
import { fr } from './general-settings-copy.fr.ts';
import { de } from './general-settings-copy.de.ts';
import { nl } from './general-settings-copy.nl.ts';
import { ptBR } from './general-settings-copy.pt-BR.ts';
import { it } from './general-settings-copy.it.ts';
import { ru } from './general-settings-copy.ru.ts';
import { pl } from './general-settings-copy.pl.ts';
import { tr } from './general-settings-copy.tr.ts';
import { vi } from './general-settings-copy.vi.ts';

/** 设置 › 通用的文案（英文是键与类型的来源，译文在 `general-settings-copy.<语言>.ts`）。 */
const en = {
  interfaceGroup: 'Interface',
  language: 'Language',
  languageDesc: 'Takes effect right away, no restart needed.',
  languageSystem: (current: string) => `System (${current})`,
  appearance: 'Appearance',
  appearanceDesc: 'Only affects BaoCut windows on this computer.',
  schemeSystem: 'System',
  schemeLight: 'Light',
  schemeDark: 'Dark',

  saveFailed: (message: string) => `Couldn't save: ${message}`,

  editingGroup: 'Editing and transcription',
  autoOpen: 'Open the video automatically after transcription',
  autoOpenDesc: "For local imports. When a link import finishes in the background you're only notified, and your current page stays as it is.",
  autoOpenNote: "Not hooked up yet: after transcription you always stay on your current page; the video doesn't open automatically.",
  lineLength: 'Subtitle line length',
  lineLengthDesc: "Sets the target length for automatic line breaks. Lines you've edited by hand aren't affected.",
  /** `custom` 是存着的自定义值的文字，没有时为 null。 */
  lineLengthNote: (maxChars: number, custom: string | null) =>
    `Not hooked up yet: automatic line breaks are currently fixed at ${maxChars} half-width characters per line (each CJK character counts as two).${custom ? ` The saved value is custom (${custom}).` : ''}`,
  cueShading: 'Cue shading in the transcript',
  cueShadingDesc: 'Shades the range of each subtitle lightly so you can see where it breaks.',
  cueShadingNote: "Not built yet: the transcript doesn't shade subtitle ranges.",

  downloadsGroup: 'Downloads and updates',
  autoUpdateOn: 'Turned on automatic update checks and downloads',
  autoUpdateOff: 'Turned off automatic update downloads',
  downloader: 'Video downloader',
  downloaderWeb: "The browser doesn't check for download tools on this computer; check in the BaoCut desktop app.",
  checking: 'Checking…',
  checkFailed: (message: string) => `Couldn't check: ${message}`,
  checkAgain: 'Check again',

  sourcesGroup: 'Download sources and offline',
  modelsEndpoint: 'Model download source',
  modelsEndpointDesc:
    "Local models are downloaded from here. Leave empty to use the public model hub (Hugging Face); if it can't be reached, enter a mirror's base URL. The BAOCUT_MODELS_ENDPOINT environment variable takes priority over this.",
  toolsEndpoint: 'Tool download source',
  toolsEndpointDesc:
    'External tools like yt-dlp are downloaded from here, at “base URL/tool/version/file name”. Leave empty to use the official release URL. The BAOCUT_TOOLS_ENDPOINT environment variable takes priority over this.',
  toolsEndpointPlaceholder: 'Official release URL',
  strictOffline: 'Strict offline',
  strictOfflineDesc:
    "When on, models and external tools aren't downloaded, and videos aren't downloaded from links. Whether cloud models and Agent engines go online isn't affected.",
  strictOfflineOn: 'Turned on strict offline',
  strictOfflineOff: 'Turned off strict offline',
  endpointChanged: (endpoint: string) => `Now using ${endpoint}`,
  endpointReset: (label: string) => `${label} reset to default`,
  save: 'Save',
  resetDefault: 'Reset to default',

  trashDays: 'Days to keep items in Trash',
  trashDaysDesc: (fallback: number | null) =>
    `Items that have been in Trash longer than this and aren't referenced, and deleted videos, are deleted permanently (checked at startup and every 6 hours after). Items still referenced are kept. Clear it to reset to the default${fallback ? ` of ${fallback} days` : ''}.`,
};

export type GeneralSettingsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
