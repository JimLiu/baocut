import { defineMessages, LOCALES } from './i18n.ts';
import type { SettingKey } from './settings.ts';
import { zhHans } from './settings-copy.zh-Hans.ts';
import { zhHant } from './settings-copy.zh-Hant.ts';
import { ja } from './settings-copy.ja.ts';
import { ko } from './settings-copy.ko.ts';
import { es } from './settings-copy.es.ts';
import { fr } from './settings-copy.fr.ts';
import { de } from './settings-copy.de.ts';
import { nl } from './settings-copy.nl.ts';
import { ptBR } from './settings-copy.pt-BR.ts';
import { it } from './settings-copy.it.ts';
import { ru } from './settings-copy.ru.ts';
import { pl } from './settings-copy.pl.ts';
import { tr } from './settings-copy.tr.ts';
import { vi } from './settings-copy.vi.ts';

/** 每个设置键给人看的一句说明（设置页与 `baocut settings` 用）。英文在这里，译文在 `settings-copy.<语言>.ts`。 */
const en = {
  'agent.defaultDriver': 'Agent for new sessions; null uses the built-in default (codex). Fixed when a session is created',
  'agent.defaultModel': "Model for new sessions; null uses the recommended model (Sonnet for Claude Code, a -sol model for Codex), __agent-default__ passes no model so the Agent's own CLI config decides",
  'agent.defaultEffort': "Reasoning effort for new sessions; null uses the Agent's own default",
  'agent.defaultAccessMode':
    'Used by sessions that have never switched access mode: ask, autoAcceptEdits, auto, fullAccess, or plan (the old values controlled and authorized are treated as ask and fullAccess)',
  'ui.language': `Interface language: system follows the system language (English when there is no matching language), or a language code (${LOCALES.join(', ')}). Text the Runtime shows to people uses it too`,
  'captions.maxLineLength': 'Target line length for automatic line breaks (characters): cjk for Chinese, Japanese, and Korean text, other for everything else',
  'transcribe.afterComplete': 'After transcription: open-video opens the video, notify only notifies, nothing does nothing',
  'downloads.directory':
    'Default save location for tool results without a video, media downloaded from links, and files handed over by downloads_save (absolute path); null uses ~/Downloads on this host, regardless of project',
  'models.downloadEndpoint':
    'Download source for local models (mirror base URL, http(s)://); null uses the public model hub. The BAOCUT_MODELS_ENDPOINT environment variable takes precedence',
  'models.dir':
    "Folder for local models (absolute path); null uses models in the data folder. The BAOCUT_MODELS_DIR environment variable takes precedence. Change it with models.setDir, not settings set",
  'tools.downloadEndpoint':
    'Download source for managed external tools (yt-dlp) (mirror base URL, http(s)://, files at <base>/<tool>/<version>/<file>); null uses the official release URL. The BAOCUT_TOOLS_ENDPOINT environment variable takes precedence',
  'fonts.autoDownload':
    "Automatically download fonts that layout needs, that aren't on this computer, and that are in the font catalog (preview and export); when off, draws with a fallback font and shows a notice",
  'fonts.cssEndpoint': 'Base URL of the font CSS API (mirror, https://); null uses https://fonts.googleapis.com',
  'fonts.fileEndpoint': 'Base URL for font files (mirror, https://; files are only fetched from under it); null uses https://fonts.gstatic.com',
  'space.trashRetentionDays':
    'Days to keep items in the Space trash (1–3650): unreferenced items and deleted videos older than this are permanently deleted periodically',
  'cache.maxSizeMiB': "Size limit for the data folder's cache, in MiB (256–1048576): above it, the oldest cached files (media analysis, playback copies) are deleted until it drops to 90%. The cross-video search index is never deleted",
  'resources.capacity':
    'Advanced: machine capacity for resource scheduling { memoryMiB, gpuMemoryMiB, cpuThreads }; an item set to null is detected automatically; null detects everything (memory and CPU come from the system, GPU memory on Apple silicon is estimated from unified memory)',
  'runtime.idleExitMinutes':
    'Minutes a Runtime started by the CLI stays idle before it exits on its own (1–1440): no connections, no tasks, no open external services. The desktop app and Runtimes started by hand are not affected',
  'updates.autoCheck': 'Check for app updates automatically',
  'updates.autoDownload': 'Download new versions in the background (without installing them automatically)',
  'diagnostics.enabled': 'Send anonymous usage statistics and performance summaries (no media, text, or paths)',
  'offline.strict': "Strict offline: don't send anything to any online service",
} satisfies Record<SettingKey, string>;

export type SettingDescriptionMessages = typeof en;

export const SETTING_DESCRIPTION_MESSAGES = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
