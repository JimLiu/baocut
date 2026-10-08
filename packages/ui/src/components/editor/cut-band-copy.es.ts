import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';
const QUOTE_MAX = 40;
const quote = (text: string) => `«${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}»`;
const cut = (seconds: number, text: string) => text ? `Cortado ${secondsLabel(seconds)}: ${quote(text)}` : `Cortado ${secondsLabel(seconds)}`;
export const es: CutBandMessages = {
 cut, hint: (mac) => `Haz clic para restaurar · arrastra los bordes para cambiar el intervalo (mantén ${mac ? 'Option' : 'Alt'} para desactivar el ajuste)`, label: (seconds, text) => `Corte, ${cut(seconds, text)}, haz clic para restaurar`, tag: (seconds, edge, word) => `−${secondsLabel(seconds)}${word ? edge === 'start' ? ` · desde «${word.trim()}»` : ` · hasta «${word.trim()}»` : ''}`, tagRestore: 'Suelta para restaurar', retimeLabel: 'Cambiar intervalo de corte', retimed: (before, after) => `Intervalo de corte cambiado · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
