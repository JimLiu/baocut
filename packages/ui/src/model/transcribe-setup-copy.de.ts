import { pluralForm } from '@baocut/protocol';
import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const de: TranscribeSetupMessages = {
  notConnected: "Nicht verbunden",
  unavailable: "Nicht verfügbar",
  autoDetect: "Automatisch erkennen",
  hintNoModel: "Es ist noch nicht bekannt, welches Sprachmodell verwendet wird. Oben eines auswählen, um zu sehen, ob es Erkennungshinweise unterstützt.",

  hintUnsupported: (model: string, alt: string | null) =>
    `${model} unterstützt keine Erkennungshinweise. Glossare und Prompt können in diesem Schritt nicht verwendet werden und werden bei der Transkription übersprungen.${alt ? ` Für ihre Verwendung bei der Transkription wechseln zu ${alt}.` : ""}`,

  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `${b.custom}-Zeichen-Prompt` : "kein Prompt";
    const dropped = b.dropped ? ` · ${b.dropped} weitere passen nicht hinein; zuerst aufgeführte Glossare werden zuerst aufgenommen` : "";
    return `Gesendet an ${model}: ${custom} + ${b.terms} ${pluralForm('de', b.terms, { one: "Begriff", other: "Begriffe" })} · etwa ${b.chars} / ${max} Zeichen${dropped}`;
  },
  glossaryGone: "Nicht mehr in der Glossarbibliothek · diesmal nicht verwendet",
  glossaryTranslation: "Übersetzungsglossar; nicht für Transkription · diesmal nicht verwendet",
  anyLanguage: "Beliebige Sprache",
  termCount: (count: number) => `${count} ${pluralForm('de', count, { one: "Begriff", other: "Begriffe" })}`,
  noDefaultModel: "Noch kein Standard-Sprachmodell",
  defaultModel: (label: string) => `${label} (Standard)`,
  autoDetectLanguage: "Sprache automatisch erkennen",
  glossaries: (count: number) => `${count} ${pluralForm('de', count, { one: "Glossar", other: "Glossare" })}`,
  hasPrompt: "Mit Prompt",
  noDefaultFacts: "Noch kein Standard-Sprachmodell. Eines auswählen oder auf der Seite „Modelle“ als Standard festlegen. Beim Start ohne Auswahl wird angezeigt, was fehlt.",
  modelUnusable: "Dieses Modell kann derzeit nicht verwendet werden",
  acceptsHint: "Unterstützt Erkennungshinweise",
  noHint: "Keine Erkennungshinweise",
  followDefault: (facts: string) => `Verwendet Standard · ${facts}`,
};
