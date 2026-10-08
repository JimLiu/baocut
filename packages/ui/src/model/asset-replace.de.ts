import type { PlaceableKind } from "./editor-ops.ts";
import { pluralForm } from '@baocut/protocol';
import type { AssetReplaceMessages } from './asset-replace.ts';

export const de: AssetReplaceMessages = {
  cantReplaceKind: "Diese Materialart kann noch nicht ersetzt werden.",
  sameKind: (kind: PlaceableKind) => `Nur durch dieselbe Materialart ersetzbar; benötigt: ${{ video: "ein Video", image: "ein Bild", audio: "Audio" }[kind]} als Material.`,
  sameAsset: "Dies ist das aktuelle Material. Ein anderes auswählen.",
  unused: "Dieses Material wird nicht in der Zeitleiste verwendet; nichts zu ersetzen.",
  tooShort: "Das neue Material ist kürzer als ein einzelner Frame.",
  allLocked: "Alle verwendenden Clips sind gesperrt (oder vorgerenderte Kompositionsersatzdarstellungen). Zuerst entsperren.",
  durationUnknown: "Materiallänge unbekannt; Clips behalten vorerst ihre Länge.",
  longEnoughMany: "Neues Material ist lang genug. Cliplängen und Zeitleiste bleiben unverändert.",
  longEnoughOne: "Neues Material ist lang genug. Cliplänge und Zeitleiste bleiben unverändert.",
  shortenMany: (n: number, seconds: string) => `${pluralForm('de', n, { one: "1 Clip wird", other: `${n} Clips werden` })} kürzer; insgesamt ${seconds} s`,
  shortenOne: (seconds: string) => `Der Clip wird um ${seconds} s kürzer`,
  moved: (head: string, n: number) => `${head}; ${pluralForm('de', n, { one: "der nächste Clip", other: `die nächsten ${n} Clips` })} auf der Spur rücken nach vorne.`,
  trackShorter: (head: string) => `${head}; die Spur wird kürzer.`,
  transitions: (n: number) => (pluralForm('de', n, { one: "Der Übergang dieser Clips wird entfernt.", other: `${n} Übergänge dieser Clips werden entfernt.` })),
  captions: (n: number) =>
    `${pluralForm('de', n, { one: "1 Untertitel ist", other: `${n} Untertitel sind` })} an diesen Clips ausgerichtet und müssen nach Ersetzen neu ausgerichtet werden.`,
  ducking: (n: number) =>
    `${pluralForm('de', n, { one: "1 Absenkungsregel verweist", other: `${n} Absenkungsregeln verweisen` })} auf diese Clips und passen nach Ersetzen nicht mehr.`,
};
