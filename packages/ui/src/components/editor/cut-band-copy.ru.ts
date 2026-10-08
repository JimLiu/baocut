import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';


const QUOTE_MAX = 40;

const quote = (text: string) => `«${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}»`;

const cut = (seconds: number, text: string) => (text ? `Вырезано ${secondsLabel(seconds)}: ${quote(text)}` : `Вырезано ${secondsLabel(seconds)}`);

export const ru: CutBandMessages = {

  cut,

  hint: (mac: boolean) => `Нажмите для восстановления · перетащите края для изменения диапазона (удерживайте ${mac ? "Option" : "Alt"} для отключения привязки)`,

  label: (seconds: number, text: string) => `Вырезано, ${cut(seconds, text)}, нажмите для восстановления`,

  tag: (seconds: number, edge: 'start' | 'end', word: string | null) => `−${secondsLabel(seconds)}${word ? (edge === "start" ? ` · от «${word.trim()}»` : ` · до «${word.trim()}»`) : ""}`,
  tagRestore: "Отпустите для восстановления",

  retimeLabel: "Изменить вырезанный участок",
  retimed: (before: number, after: number) => `Диапазон вырезания изменён · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
