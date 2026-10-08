import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

const quote = (text: string) => `« ${text.length > 40 ? `${text.slice(0, 39)}…` : text} »`;
const cut = (seconds: number, text: string) => text ? `Coupé ${secondsLabel(seconds)} : ${quote(text)}` : `Coupé ${secondsLabel(seconds)}`;

export const fr: CutBandMessages = {

  cut,

  hint: (mac: boolean) => `Cliquez pour restaurer · glissez les bords pour changer la plage (maintenez ${mac ? "Option" : "Alt"} pour désactiver l’aimantation)`,

  label: (seconds: number, text: string) => `Coupé, ${cut(seconds, text)}, cliquez pour restaurer`,

  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · depuis « ${word.trim()} »` : ` · jusqu’à « ${word.trim()} »`) : ""}`,
  tagRestore: "Relâcher pour restaurer",

  retimeLabel: "Modifier la plage coupée",
  retimed: (before: number, after: number) => `Plage de coupe modifiée · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
