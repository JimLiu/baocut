import { defineMessages } from '@baocut/protocol';
import { zhHans } from './system-access-copy.zh-Hans.ts';
import { zhHant } from './system-access-copy.zh-Hant.ts';
import { ja } from './system-access-copy.ja.ts';
import { ko } from './system-access-copy.ko.ts';
import { es } from './system-access-copy.es.ts';
import { fr } from './system-access-copy.fr.ts';
import { de } from './system-access-copy.de.ts';
import { nl } from './system-access-copy.nl.ts';
import { ptBR } from './system-access-copy.pt-BR.ts';
import { it } from './system-access-copy.it.ts';
import { ru } from './system-access-copy.ru.ts';
import { pl } from './system-access-copy.pl.ts';
import { tr } from './system-access-copy.tr.ts';
import { vi } from './system-access-copy.vi.ts';

/**
 * macOS 的完全磁盘访问权限（产品设计 §7.9，架构设计 §12.11）：授权卡、下载前的询问、设置 › 隐私与权限里的一行。
 * 英文是键与类型的来源，译文在 `system-access-copy.<语言>.ts`。`names` 是已经按语言连好的浏览器名。
 */
const en = {
  cardTitle: (names: string) => `Allow BaoCut to read ${names} cookies`,
  cardBody: "macOS needs to give BaoCut “Full Disk Access” first. Click “Open System Settings” and BaoCut takes you straight to that page. BaoCut only reads the browsers you check, nothing else.",
  openedTitle: "Turn on BaoCut in System Settings, then come back",
  openedBody: "Turn on the switch next to BaoCut. When macOS asks to quit and reopen BaoCut, choose “Quit & Reopen”. If BaoCut isn’t in the list, click “+” under the list to add it. If macOS doesn’t offer to reopen, click “Restart BaoCut” below.",
  open: "Open System Settings",
  openAgain: "Open System Settings again",
  restart: "Restart BaoCut",
  askTitle: (names: string) => `Allow access to ${names} cookies first?`,
  askBody: (names: string) => `This download uses your ${names} sign-in, and macOS needs to give BaoCut “Full Disk Access” first. Turn it on in System Settings and download again, or skip it this time and continue with the other browsers.`,
  skip: "Skip this time",
  settingLabel: "Full Disk Access",
  settingAllowed: "Allowed. BaoCut can read files on external drives, Desktop, Documents and Downloads, and Safari cookies, but only the media, save locations and browsers you choose.",
  settingMissing: "Not allowed. macOS stops apps from reading external drives, Desktop, Documents, Downloads and Safari cookies. Once allowed, BaoCut won’t fail on these locations because of permissions. It only reads the media, save locations and browsers you choose.",
  openFailed: "Couldn’t open System Settings. Open System Settings › Privacy & Security › Full Disk Access yourself.",
};
export type SystemAccessMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
