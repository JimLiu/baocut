const QUOTE_MAX = 40;
const quote = (text: string) => `‘${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}’`;
const cut = (seconds: number, text: string) => text ? `Geknipt ${secondsLabel(seconds)}: ${quote(text)}` : `Geknipt ${secondsLabel(seconds)}`;
import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const nl: CutBandMessages = {

  cut,

  hint: (mac: boolean) => `Klik om te herstellen · sleep de randen om het bereik te wijzigen (houd ${mac ? "Option" : "Alt"} ingedrukt om uitlijnen uit te schakelen)`,

  label: (seconds: number, text: string) => `Geknipt, ${cut(seconds, text)}, klik om te herstellen`,

  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · van ‘${word.trim()}’` : ` · tot ‘${word.trim()}’`) : ""}`,
  tagRestore: "Loslaten om te herstellen",

  retimeLabel: "Knipbereik wijzigen",
  retimed: (before: number, after: number) => `Knipbereik gewijzigd · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
