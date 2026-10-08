import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';


const QUOTE_MAX = 40;

const quote = (text: string) => `„${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;

const cut = (seconds: number, text: string) => (text ? `Wycięto ${secondsLabel(seconds)}: ${quote(text)}` : `Wycięto ${secondsLabel(seconds)}`);

export const pl: CutBandMessages = {

  cut,

  hint: (mac: boolean) => `Kliknij, aby przywrócić · przeciągnij krawędzie, aby zmienić zakres (przytrzymaj ${mac ? "Option" : "Alt"}, aby wyłączyć przyciąganie)`,

  label: (seconds: number, text: string) => `Wycięto, ${cut(seconds, text)}, kliknij, aby przywrócić`,

  tag: (seconds: number, edge: 'start' | 'end', word: string | null) => `−${secondsLabel(seconds)}${word ? (edge === "start" ? ` · od „${word.trim()}”` : ` · do „${word.trim()}”`) : ""}`,
  tagRestore: "Puść, aby przywrócić",

  retimeLabel: "Zmień wycięty zakres",
  retimed: (before: number, after: number) => `Zmieniono zakres cięcia · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
