import { defineMessages } from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { kindOfFileName } from './space.ts';
import { langName } from './tools-models.ts';
import { TARGET_LANGUAGES as TARGET_TAGS } from './translate-setup.ts';
import { zhHans } from './new-flow.zh-Hans.ts';
import { zhHant } from './new-flow.zh-Hant.ts';
import { ja } from './new-flow.ja.ts';
import { ko } from './new-flow.ko.ts';
import { es } from './new-flow.es.ts';
import { fr } from './new-flow.fr.ts';
import { de } from './new-flow.de.ts';
import { nl } from './new-flow.nl.ts';
import { ptBR } from './new-flow.pt-BR.ts';
import { it } from './new-flow.it.ts';
import { ru } from './new-flow.ru.ts';
import { pl } from './new-flow.pl.ts';
import { tr } from './new-flow.tr.ts';
import { vi } from './new-flow.vi.ts';

/** 链接卡与翻译跟进的文案（译文在 `new-flow.<语言>.ts`）。 */
const en = {
  bilibili: 'Bilibili',
  directLink: 'Direct link',
  webPage: 'Web page',
  videoLink: (site: string) => `${site} video link`,
  /** 主按钮「翻译成 English」。 */
  into: (name: string) => `Translate into ${name}`,
  translated: (language: string) => `Translation done · ${language} subtitles are on the video`,
};
export type NewFlowMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 原先首页固定流程（设计稿 page-new.jsx ②、model-newproject.js、model-media.js）的纯逻辑里还在用的部分：
 * 素材的种类、链接像不像个链接与链接卡上的事实、画幅尺寸与背景色、目标语言，以及链接导入跟进（components/start/flow-runner.ts）
 * 要的「要不要转录」「转录完接着翻译」。首页的固定流程已经退场（起始页只剩输入框、快捷开始与模板）。
 */

export type FlowKey = 'sub' | 'a2v' | 'trans' | 'clean' | 'blank';
export type MediaKind = 'video' | 'audio' | 'other';
export type Ratio = '16:9' | '9:16' | '1:1';
export type BgHue = 'gray' | 'blue' | 'purple' | 'green' | 'orange' | 'magenta';

// ---- 素材 ----

/** 路径的最后一段。 */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** 视频 / 音频 / 别的：与 Runtime 的 Space 分类同一张表。 */
export function mediaKindOf(name: string): MediaKind {
  const kind = kindOfFileName(fileNameOf(name));
  return kind === 'video-file' ? 'video' : kind === 'audio' ? 'audio' : 'other';
}

// ---- 链接 ----

/** 地址像不像个地址：卡片出不出与主按钮能不能按共用这一个判据（设计稿 `urlValid`）。 */
export function urlValid(url: string): boolean {
  return /^https?:\/\/\S+\.\S+/.test(url.trim());
}

export function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return match
    ? match[1]!
        .replace(/^www\./i, '')
        .replace(/:\d+$/, '')
        .toLowerCase()
    : '';
}

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'];

/** 直链（地址末尾就是个媒体文件）的扩展名；页面地址返回空串。 */
export function directExt(url: string): string {
  const match = /\/([^/?#]+)\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url.trim());
  const ext = match ? match[2]!.toLowerCase() : '';
  return VIDEO_EXT.includes(ext) || AUDIO_EXT.includes(ext) ? ext : '';
}

const SITES: { host: RegExp; readonly name: string }[] = [
  { host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, name: 'YouTube' },
  {
    host: /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/,
    get name() {
      return M.bilibili;
    },
  },
  { host: /(^|\.)vimeo\.com$/, name: 'Vimeo' },
  { host: /(^|\.)twitch\.tv$/, name: 'Twitch' },
];

export interface LinkFacts {
  /** 站点名（认得的写中文名或品牌名，别的写主机名）；直链写「直链」。 */
  site: string;
  direct: boolean;
  host: string;
  /** 卡片标题：直链是文件名，页面是「YouTube 视频链接」。真标题要解析之后才知道，这里不编。 */
  title: string;
}

/** 粘完地址、开始之前卡片上能说的事实：只从地址本身看得出来的（设计稿 `probeUrl` 去掉演示用的假元数据）。 */
export function linkFacts(url: string): LinkFacts {
  const trimmed = url.trim();
  const host = hostOf(trimmed);
  const direct = directExt(trimmed) !== '';
  if (direct) {
    const match = /\/([^/?#]+)(?:[?#]|$)/.exec(trimmed);
    let name = match ? match[1]! : host;
    try {
      name = decodeURIComponent(name);
    } catch {
      // 保留原样。
    }
    return { site: M.directLink, direct, host, title: name };
  }
  const site = SITES.find((s) => s.host.test(host))?.name ?? (host || M.webPage);
  return { site, direct, host, title: M.videoLink(site) };
}

// ---- 画幅与背景 ----

export const RATIO_SIZE: Record<Ratio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * 背景板六色 → 画布底色（设计稿 `bgToken`：灰取 300、其余取 400）。画布上的颜色是视频内容，不随界面主题变，所以写成
 * 这几个 token 在浅色主题下的值。
 */
export const BG_COLOR: Record<BgHue, string> = {
  gray: '#DADADA',
  blue: '#ACCFFD',
  purple: '#DDC1F6',
  green: '#6BE3A2',
  orange: '#FFC15E',
  magenta: '#FFB9D0',
};

// ---- 目标语言 ----

export interface TargetLanguage {
  /** BCP 47。 */
  code: string;
  /** 这门语言自己的写法（主按钮写「翻译成 English」）。 */
  name: string;
  /** 中文名。 */
  native: string;
}

/** 能翻成的语言：同字幕面板「翻译成…」（model/translate-setup.ts），中文分简繁。 */
export const TARGET_LANGUAGES: readonly TargetLanguage[] = TARGET_TAGS.map((code) => ({
  code,
  name: languageName(code),
  get native() {
    return langName(code);
  },
}));

export function targetLanguage(code: string): TargetLanguage {
  return TARGET_LANGUAGES.find((l) => l.code === code) ?? TARGET_LANGUAGES[0]!;
}

/** 「翻译成 English」：拉丁字母的名字前面空一格（设计稿 `into`）。 */
export function into(name: string): string {
  return M.into(name);
}

// ---- 链接导入的跟进 ----

/** 这条流程要不要转录。 */
export function needsTranscribe(flow: FlowKey, subs: boolean): boolean {
  if (flow === 'blank' || flow === 'clean') return false;
  return flow !== 'a2v' || subs;
}

/** 后续链（设计稿 `chainOf`）：转录完成后自动起的那一条；只有翻译有。 */
export function chainOf(flow: FlowKey, target: TargetLanguage): { title: string; doneToast: string } | null {
  if (flow !== 'trans') return null;
  return { title: into(target.name), doneToast: M.translated(target.native) };
}
