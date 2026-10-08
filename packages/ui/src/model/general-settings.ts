import { defineMessages, live, localizeToolStatus, SETTING_DEFAULTS, type CaptionLineLength, type ExternalToolSource, type ExternalToolStatus } from '@baocut/protocol';
import { zhHans } from './general-settings.zh-Hans.ts';
import { zhHant } from './general-settings.zh-Hant.ts';
import { ja } from './general-settings.ja.ts';
import { ko } from './general-settings.ko.ts';
import { es } from './general-settings.es.ts';
import { fr } from './general-settings.fr.ts';
import { de } from './general-settings.de.ts';
import { nl } from './general-settings.nl.ts';
import { ptBR } from './general-settings.pt-BR.ts';
import { it } from './general-settings.it.ts';
import { ru } from './general-settings.ru.ts';
import { pl } from './general-settings.pl.ts';
import { tr } from './general-settings.tr.ts';
import { vi } from './general-settings.vi.ts';

/** 设置 › 通用模型层的文案（英文是键与类型的来源，译文在 `general-settings.zh-Hans.ts`）。 */
const en = {
  lineShort: 'Short',
  lineMedium: 'Medium',
  lineLong: 'Long',
  lineLength: (cjk: number, other: number) => `CJK text: ${cjk} characters per line · Other text: ${other} characters per line`,
  endpointTooLong: (max: number) => `Too long: up to ${max} characters`,
  endpointNotUrl: 'Not a web address: it should start with http:// or https://',
  endpointScheme: 'Only addresses starting with http:// or https:// are supported',
  endpointCredentials: 'The address can’t include a user name or password',
  endpointQuery: 'The address can’t include query parameters (the part after ?)',
  endpointHash: 'The address can’t include a fragment (the part after #)',
  saveDir: {
    label: 'Default save location',
    desc: 'Tool results, downloaded videos, and files handed over by the Agent are saved here. The default is your Downloads folder.',
    systemDefault: 'Downloads folder',
    isDefault: 'Default',
    change: 'Change…',
    reset: 'Reset to default',
    pickTitle: 'Choose default save location',
    changed: 'Default save location changed',
    resetDone: 'Reset to the Downloads folder',
    pickFailed: (message: string) => `Couldn’t choose a folder: ${message}`,
    webNote: 'A browser can’t choose a folder on this computer. Set this in the BaoCut desktop app.',
  },
  source: {
    system: 'Installed on the system',
    user: 'Location you chose',
    managed: 'Downloaded by BaoCut',
    env: 'Set by an environment variable',
  } as Record<ExternalToolSource, string>,
  notInstalled: 'Not installed',
  missingDesc: 'yt-dlp isn’t installed yet. When the Agent imports from a link, it will first ask you to agree to download it (showing the source, version, size, and license).',
  consentRevoked: 'Consent withdrawn',
  revokedDesc: (facts: string) => `${facts}. You withdrew consent to use it, so importing from a link will ask you again first.`,
  available: 'Available',
  needsUpdate: 'Update needed',
  cannotRun: 'Can’t run',
  factsWhy: (facts: string, why: string) => `${facts}. ${why}`,
};
export type GeneralSettingsModelMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * 设置 › 通用（设计稿 page-settings.jsx `GeneralSection`、settings-update.jsx `AppUpdateAutoRow`、import-panel.jsx
 * `DownloaderSettings`）的纯逻辑：字幕行长的三档、下载来源的校验、下载目录与回收站天数的说法、视频下载工具的一行。
 * 取值的形状与范围照合同（packages/protocol/src/settings.ts、schemas.ts），组件只管画。
 */

// ---- 字幕行长（`captions.maxLineLength`） ----

export type LineLengthKey = 'short' | 'medium' | 'long';

/**
 * 设计稿的「短 / 中 / 长」三档。「中」就是合同的默认值；「短」「长」各差 4 个中日韩字、10 个其他字符（设计稿没给数，
 * 这里定的），都在合同的范围里（cjk 4–60，other 10–120）。
 */
export const LINE_LENGTH_PRESETS: readonly { key: LineLengthKey; label: string; value: CaptionLineLength }[] = [
  { key: 'short', get label() { return M.lineShort; }, value: { cjk: 12, other: 32 } },
  { key: 'medium', get label() { return M.lineMedium; }, value: SETTING_DEFAULTS['captions.maxLineLength'] },
  { key: 'long', get label() { return M.lineLong; }, value: { cjk: 20, other: 52 } },
];

/** 存着的行长落在哪一档；命令行设过别的数时不落在任何一档（null）。 */
export function lineLengthKey(value: CaptionLineLength | null): LineLengthKey | null {
  if (!value) return null;
  return LINE_LENGTH_PRESETS.find((p) => p.value.cjk === value.cjk && p.value.other === value.other)?.key ?? null;
}

/** 一句话写出存着的行长：「中日韩文字每行 16 字 · 其他文字每行 42 个字符」。 */
export function lineLengthText(value: CaptionLineLength): string {
  return M.lineLength(value.cjk, value.other);
}

// ---- 下载来源（`models.downloadEndpoint`、`tools.downloadEndpoint`） ----

export const ENDPOINT_MAX_LENGTH = 500;

/** 输入框里的字 → 要存的值：去掉首尾空白，空的是 null（恢复默认来源）。 */
export function endpointValue(text: string): string | null {
  const value = text.trim();
  return value === '' ? null : value;
}

/**
 * 下载来源哪里不对；能存（包括留空）时 null。规则与合同的校验（schemas.ts `isDownloadEndpoint`）相同：`http(s)://` 开头的基址，
 * 不带用户名、密码、查询参数与片段（凭据不得出现在网址里），最长 500 个字符。
 */
export function endpointProblem(text: string): string | null {
  const value = endpointValue(text);
  if (value === null) return null;
  if (value.length > ENDPOINT_MAX_LENGTH) return M.endpointTooLong(ENDPOINT_MAX_LENGTH);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return M.endpointNotUrl;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return M.endpointScheme;
  if (url.username || url.password) return M.endpointCredentials;
  if (url.search) return M.endpointQuery;
  if (url.hash) return M.endpointHash;
  return null;
}

// ---- 默认保存位置（`downloads.directory`，键名不改） ----

/**
 * 设置 › 通用 › 默认保存位置（产品设计 §2.7「页面」末段；架构设计 §5.10、§7.9「保存位置」；设计稿 page-settings.jsx `SaveDirRow`）：
 * 工具没有视频的结果、下载的视频与 Agent 交出的文件都放这里；没设时是运行 Runtime 那台电脑的系统下载文件夹。工具页的「更改…」只改那一次。
 */
export const SAVE_DIR_ROW: GeneralSettingsModelMessages['saveDir'] = live(() => M.saveDir);

// ---- 自动更新（`updates.autoCheck`、`updates.autoDownload`） ----

/** 设计稿只有一行「自动检查并下载更新」，合同是两个键：两个都开着才算开。快照没到时按默认值。 */
export function autoUpdateOn(check: boolean | null, download: boolean | null): boolean {
  return (check ?? SETTING_DEFAULTS['updates.autoCheck']) && (download ?? SETTING_DEFAULTS['updates.autoDownload']);
}

// ---- 回收站保留天数（`space.trashRetentionDays`） ----

export const TRASH_DAYS = { min: 1, max: 3650 } as const;

/** 数字框的值 → 要存的值：清空（NaN）是 null（恢复默认 30 天）；其余取整并收进 1–3650。 */
export function trashDaysValue(input: number): number | null {
  if (!Number.isFinite(input)) return null;
  return Math.min(TRASH_DAYS.max, Math.max(TRASH_DAYS.min, Math.round(input)));
}

// ---- 视频下载工具（`externalTools.list` 的 yt-dlp 一项） ----

const SOURCE_LABEL: Record<ExternalToolSource, string> = live(() => M.source);

export interface DownloaderLine {
  /** 行尾的状态词。 */
  status: string;
  tone: 'positive' | 'notice' | 'negative' | 'neutral';
  /** 行下的说明：版本与来源，不能用时是原因与补救。 */
  desc: string;
}

/**
 * yt-dlp 这一行怎么写（设计稿 `DownloaderSettings` 的状态 chip 与「yt-dlp · 版本 · 来源」）。登记表里没有它（null）时照未安装写。
 * 设计稿的安装、更新与「安装范围」在这里不做：BaoCut 只在 Agent 从链接导入、请你同意之后才下载它（link-import-tools.ts）。
 */
export function downloaderLine(probed: ExternalToolStatus | null): DownloaderLine {
  const status = probed && localizeToolStatus(probed);
  if (!status || status.state === 'missing') {
    return { status: M.notInstalled, tone: 'neutral', desc: M.missingDesc };
  }
  const facts = ['yt-dlp', status.version, status.source ? SOURCE_LABEL[status.source] : null].filter(Boolean).join(' · ');
  const why = status.remedy ?? status.reason;
  switch (status.state) {
    case 'installed': {
      const revoked = status.consentRequired && status.consent?.state === 'revoked';
      return revoked
        ? { status: M.consentRevoked, tone: 'notice', desc: M.revokedDesc(facts) }
        : { status: M.available, tone: 'positive', desc: facts };
    }
    case 'outdated':
      return { status: M.needsUpdate, tone: 'notice', desc: why ? M.factsWhy(facts, why) : facts };
    case 'unavailable':
      return { status: M.cannotRun, tone: 'negative', desc: why ? M.factsWhy(facts, why) : facts };
  }
}
