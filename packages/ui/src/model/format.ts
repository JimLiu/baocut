import { defineMessages, intlLocale } from '@baocut/protocol';
import { zhHans } from './format.zh-Hans.ts';
import { zhHant } from './format.zh-Hant.ts';
import { ja } from './format.ja.ts';
import { ko } from './format.ko.ts';
import { es } from './format.es.ts';
import { fr } from './format.fr.ts';
import { de } from './format.de.ts';
import { nl } from './format.nl.ts';
import { ptBR } from './format.pt-BR.ts';
import { it } from './format.it.ts';
import { ru } from './format.ru.ts';
import { pl } from './format.pl.ts';
import { tr } from './format.tr.ts';
import { vi } from './format.vi.ts';

/** 时长与相对时间的文案（英文是键与类型的来源，译文在 `format.zh-Hans.ts`）。 */
const en = {
  hoursMinutes: (h: number, m: number) => `${h} hr ${m} min`,
  hours: (h: number) => `${h} hr`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} sec`,
  minutes: (m: number) => `${m} min`,
  seconds: (s: number) => `${s} sec`,
  justNow: 'Just now',
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => (n === 1 ? '1 hour ago' : `${n} hours ago`),
  yesterday: 'Yesterday',
  dateThisYear: (date: Date) => new Intl.DateTimeFormat(intlLocale('en'), { month: 'short', day: 'numeric' }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat(intlLocale('en'), { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
export type FormatMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 时长：「8 秒」「1 分 5 秒」「1 小时 2 分」（英文「8 sec」「1 min 5 sec」「1 hr 2 min」）。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return m ? M.hoursMinutes(h, m) : M.hours(h);
  if (m) return s ? M.minutesSeconds(m, s) : M.minutes(m);
  return M.seconds(s);
}

/** 多久前：「刚刚」「5 分钟前」「3 小时前」「昨天」「9月30日」。 */
export function agoLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  const diff = Math.max(0, now - t);
  const minute = 60_000;
  if (diff < minute) return M.justNow;
  if (diff < 60 * minute) return M.minutesAgo(Math.floor(diff / minute));
  if (diff < 24 * 60 * minute) return M.hoursAgo(Math.floor(diff / (60 * minute)));
  const date = new Date(t);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date >= yesterday) return M.yesterday;
  if (date.getFullYear() === today.getFullYear()) return M.dateThisYear(date);
  return M.dateWithYear(date);
}

/**
 * 把用户主目录缩写成 ~：macOS 的 `/Users/<名字>`、Linux 的 `/home/<名字>`、Windows 的 `C:\Users\<名字>`（任意盘符，不分大小写）。
 * 后面的部分连同分隔符原样保留（`~\BaoCut\models`）。
 */
export function shortenPath(path: string): string {
  const match = /^\/(?:Users|home)\/[^/]+/.exec(path) ?? /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i.exec(path);
  return match ? `~${path.slice(match[0].length)}` : path;
}

/**
 * 播放器里的时间：「0:07」「1:05」「1:02:03」；`tenths` 时带一位小数「1:05.3」，`hours` 时不到一小时也写小时位。
 * 向下截断，不显示还没播到的时间；截断只影响呈现（产品设计 §5.8）。
 */
export function formatClock(seconds: number, options: { tenths?: boolean; hours?: boolean } = {}): string {
  const tenthsTotal = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 10 + 1e-6) : 0;
  const whole = Math.floor(tenthsTotal / 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const ss = String(whole % 60).padStart(2, '0');
  const base = h || options.hours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return options.tenths ? `${base}.${tenthsTotal % 10}` : base;
}

/**
 * 走带的时码：「00:16.1」「03:26.0」，满一小时进位「1:02:03.5」；`decimals: 0` 去掉小数位（原型 model-time.js `timecode`）。
 * 先按输出精度四舍五入再拆时、分、秒，否则 9.999999 会写成「00:010.0」、59.99 写成「00:60.0」——
 * 两个浮点秒相减（22.4 − 12.4）就会落到这种值上。
 */
export function formatTenths(seconds: number, { decimals = 1 }: { decimals?: 0 | 1 } = {}): string {
  const negative = seconds < 0;
  const tenths = decimals !== 0;
  let s = Math.abs(+seconds || 0);
  s = tenths ? Math.round(s * 10) / 10 : Math.round(s);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const sec = (s < 10 ? '0' : '') + (tenths ? s.toFixed(1) : String(s));
  const mm = String(m).padStart(2, '0');
  return (negative ? '-' : '') + (h > 0 ? `${h}:${mm}:${sec}` : `${mm}:${sec}`);
}
