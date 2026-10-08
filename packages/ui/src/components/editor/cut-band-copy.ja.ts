import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;

const quote = (text: string) => `「${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}」`;

const cut = (seconds: number, text: string) => (text ? `${secondsLabel(seconds)} をカット：${quote(text)}` : `${secondsLabel(seconds)} をカット`);

export const ja: CutBandMessages = {
  cut,
  hint: (mac: boolean) => `クリックで復元 · 両端をドラッグして範囲を変更（${mac ? 'Option' : 'Alt'} を押しながらでスナップしない）`,
  label: (seconds: number, text: string) => `カット、${cut(seconds, text)}、クリックで復元`,
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · 「${word.trim()}」から` : ` · 「${word.trim()}」まで`) : ''}`,
  tagRestore: '離すと復元',
  retimeLabel: 'カット範囲を変更',
  retimed: (before: number, after: number) => `カット範囲を変更しました · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
