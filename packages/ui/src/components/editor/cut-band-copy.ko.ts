import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;

const quote = (text: string) => `“${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;

const cut = (seconds: number, text: string) => (text ? `${secondsLabel(seconds)} 잘라 냄: ${quote(text)}` : `${secondsLabel(seconds)} 잘라 냄`);

export const ko: CutBandMessages = {
  cut,
  hint: (mac: boolean) => `클릭해 복원 · 가장자리를 드래그해 범위 변경(${mac ? 'Option' : 'Alt'} 키를 누르고 있으면 스냅 해제)`,
  label: (seconds: number, text: string) => `컷, ${cut(seconds, text)}, 클릭해 복원`,
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · “${word.trim()}”부터` : ` · “${word.trim()}”까지`) : ''}`,
  tagRestore: '놓으면 복원',
  retimeLabel: '컷 범위 변경',
  retimed: (before: number, after: number) => `컷 범위 변경 · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
