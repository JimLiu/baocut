import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;

const quote = (text: string) => `「${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}」`;

const cut = (seconds: number, text: string) => (text ? `已剪掉 ${secondsLabel(seconds)}：${quote(text)}` : `已剪掉 ${secondsLabel(seconds)}`);

export const zhHant: CutBandMessages = {
  cut,
  hint: (mac: boolean) => `按一下即可回復 · 拖曳邊緣可變更範圍（按住 ${mac ? 'Option' : 'Alt'} 可關閉吸附）`,
  label: (seconds: number, text: string) => `剪除區段，${cut(seconds, text)}，按一下即可回復`,
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · 從「${word.trim()}」起` : ` · 到「${word.trim()}」為止`) : ''}`,
  tagRestore: '放開即可回復',
  retimeLabel: '變更剪除範圍',
  retimed: (before: number, after: number) => `已變更剪除範圍 · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
