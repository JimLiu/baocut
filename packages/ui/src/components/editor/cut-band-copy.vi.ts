import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const QUOTE_MAX = 40;
const quote = (text: string) => `“${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;
const cut = (seconds: number, text: string) => text ? `Đã cắt ${secondsLabel(seconds)}: ${quote(text)}` : `Đã cắt ${secondsLabel(seconds)}`;

export const vi: CutBandMessages = {
cut, hint: (mac) => `Nhấp để khôi phục · kéo cạnh để đổi phạm vi (giữ ${mac ? 'Option' : 'Alt'} để tắt bám)`, label: (seconds, text) => `Đoạn cắt, ${cut(seconds, text)}, nhấp để khôi phục`, tag: (seconds, edge, word) => `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · từ “${word.trim()}”` : ` · đến “${word.trim()}”`) : ''}`, tagRestore: 'Thả để khôi phục', retimeLabel: 'Đổi phạm vi cắt', retimed: (before, after) => `Đã đổi phạm vi cắt · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
