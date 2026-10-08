import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;

const quote = (text: string) => `«${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}»`;

const cut = (seconds: number, text: string) => (text ? `Tagliato: ${secondsLabel(seconds)}: ${quote(text)}` : `Tagliato: ${secondsLabel(seconds)}`);

export const it: CutBandMessages = {
  cut,
  hint: (mac: boolean) => `Fai clic per ripristinare · trascina i bordi per cambiare l’intervallo (tieni premuto ${mac ? 'Option' : 'Alt'} per disattivare l’aggancio)`,
  label: (seconds: number, text: string) => `Taglio, ${cut(seconds, text)}, fai clic per ripristinare`,
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · da «${word.trim()}»` : ` · a «${word.trim()}»`) : ''}`,
  tagRestore: 'Rilascia per ripristinare',
  retimeLabel: 'Cambia intervallo del taglio',
  retimed: (before: number, after: number) => `Intervallo del taglio modificato · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
