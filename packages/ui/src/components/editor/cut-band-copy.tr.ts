import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;
const quote = (text: string) => `“${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;
const cut = (seconds: number, text: string) => text ? `Kesildi ${secondsLabel(seconds)}: ${quote(text)}` : `Kesildi ${secondsLabel(seconds)}`;

export const tr: CutBandMessages = {
cut, hint: (mac) => `Geri yüklemek için tıklayın · aralığı değiştirmek için kenarları sürükleyin (yapışmayı kapatmak için ${mac ? 'Option' : 'Alt'} basılı tutun)`, label: (seconds, text) => `Kesim, ${cut(seconds, text)}, geri yüklemek için tıklayın`, tag: (seconds, edge, word) => `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · başlangıç: “${word.trim()}”` : ` · bitiş: “${word.trim()}”`) : ''}`, tagRestore: 'Geri yüklemek için bırak', retimeLabel: 'Kesim aralığını değiştir', retimed: (before, after) => `Kesim aralığı değişti · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
