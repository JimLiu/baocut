import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;

const quote = (text: string) => `“${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;

const cut = (seconds: number, text: string) => (text ? `Cortado: ${secondsLabel(seconds)}: ${quote(text)}` : `Cortado: ${secondsLabel(seconds)}`);

export const ptBR: CutBandMessages = {
  cut,
  hint: (mac: boolean) => `Clique para restaurar · arraste as bordas para alterar o intervalo (segure ${mac ? 'Option' : 'Alt'} para desativar o ajuste)`,
  label: (seconds: number, text: string) => `Corte, ${cut(seconds, text)}, clique para restaurar`,
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · de “${word.trim()}”` : ` · até “${word.trim()}”`) : ''}`,
  tagRestore: 'Soltar para restaurar',
  retimeLabel: 'Alterar intervalo do corte',
  retimed: (before: number, after: number) => `Intervalo do corte alterado · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
