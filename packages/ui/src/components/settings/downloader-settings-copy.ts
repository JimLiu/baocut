import { defineMessages } from '@baocut/protocol';
import { zhHans } from './downloader-settings-copy.zh-Hans.ts';
import { zhHant } from './downloader-settings-copy.zh-Hant.ts';
import { ja } from './downloader-settings-copy.ja.ts';
import { ko } from './downloader-settings-copy.ko.ts';
import { es } from './downloader-settings-copy.es.ts';
import { fr } from './downloader-settings-copy.fr.ts';
import { de } from './downloader-settings-copy.de.ts';
import { nl } from './downloader-settings-copy.nl.ts';
import { ptBR } from './downloader-settings-copy.pt-BR.ts';
import { it } from './downloader-settings-copy.it.ts';
import { ru } from './downloader-settings-copy.ru.ts';
import { pl } from './downloader-settings-copy.pl.ts';
import { tr } from './downloader-settings-copy.tr.ts';
import { vi } from './downloader-settings-copy.vi.ts';

/** 设置 › 视频下载（downloader-settings.tsx）的文案。英文是键与类型的来源，译文在 `downloader-settings-copy.<语言>.ts`。 */
const en = {
  lead: 'Downloading videos from links uses yt-dlp. Download video, transcribe from a link and the Agent all download with these settings.',
  toolGroup: 'Download tool',
  cookiesLead:
    'Downloads use your sign-in from the browser, so videos you have to sign in to watch can be downloaded too. By default every detected browser is used.',
  autoUpdate: "Update yt-dlp automatically",
  autoUpdateDesc:
    "Checks for a new stable release once a day. When there is one, the copy BaoCut downloaded is replaced after its checksum is verified; you can keep downloading with the current copy until then. A yt-dlp you installed yourself is not changed.",
  autoUpdateChecked: (when: string, version: string) => `Last checked ${when} · latest version ${version}`,
};
export type DownloaderSettingsMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
