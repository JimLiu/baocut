const QUOTE_MAX = 40;
const quote = (text: string) => `„${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}“`;
const cut = (seconds: number, text: string) => text ? `Schnitt ${secondsLabel(seconds)}: ${quote(text)}` : `Schnitt ${secondsLabel(seconds)}`;
import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const de: CutBandMessages = {

  cut,

  hint: (mac: boolean) => `Klicken zum Wiederherstellen · Ränder ziehen, um den Bereich zu ändern (${mac ? "Option" : "Alt"} gedrückt halten, um Einrasten auszuschalten)`,

  label: (seconds: number, text: string) => `Herausgeschnitten, ${cut(seconds, text)}, klicken zum Wiederherstellen`,

  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · von „${word.trim()}“` : ` · bis „${word.trim()}“`) : ""}`,
  tagRestore: "Loslassen zum Wiederherstellen",

  retimeLabel: "Schnittbereich ändern",
  retimed: (before: number, after: number) => `Schnittbereich geändert · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
