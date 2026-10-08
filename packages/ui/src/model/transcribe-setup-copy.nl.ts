import { pluralForm } from '@baocut/protocol';
import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const nl: TranscribeSetupMessages = {
  notConnected: "Niet verbonden",
  unavailable: "Niet beschikbaar",
  autoDetect: "Automatisch detecteren",
  hintNoModel: "Het is nog niet bekend welk spraakmodel wordt gebruikt. Kies er hierboven een om te zien of het herkenningshints accepteert.",

  hintUnsupported: (model: string, alt: string | null) =>
    `${model} accepteert geen herkenningshints, dus woordenlijsten en de prompt kunnen niet in deze stap worden gebruikt en worden overgeslagen bij het transcriberen.${alt ? ` Om die bij het transcriberen te gebruiken, kies ${alt}.` : ""}`,

  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `${b.custom}-tekensprompt` : "geen prompt";
    const dropped = b.dropped ? ` · ${b.dropped} meer passen niet; woordenlijsten die bovenaan staan gaan eerst mee` : "";
    return `Verzonden naar ${model}: ${custom} + ${b.terms} ${pluralForm('nl', b.terms, { one: "term", other: "termen" })} · ongeveer ${b.chars} / ${max} tekens${dropped}`;
  },
  glossaryGone: "Niet meer in de woordenlijstbibliotheek · deze keer niet gebruikt",
  glossaryTranslation: "Vertaalwoordenlijst; niet voor transcriptie · deze keer niet gebruikt",
  anyLanguage: "Elke taal",
  termCount: (count: number) => `${count} ${pluralForm('nl', count, { one: "term", other: "termen" })}`,
  noDefaultModel: "Nog geen standaardspraakmodel",
  defaultModel: (label: string) => `${label} (standaard)`,
  autoDetectLanguage: "Taal automatisch detecteren",
  glossaries: (count: number) => `${count} ${pluralForm('nl', count, { one: "woordenlijst", other: "woordenlijsten" })}`,
  hasPrompt: "Met prompt",
  noDefaultFacts: "Nog geen standaardspraakmodel. Kies er een of stel een standaard in op de pagina Modellen. Als je start zonder te kiezen, zie je wat er ontbreekt.",
  modelUnusable: "Dit model kan nu niet worden gebruikt",
  acceptsHint: "Accepteert herkenningshints",
  noHint: "Geen herkenningshints",
  followDefault: (facts: string) => `Gebruikt de standaard · ${facts}`,
};
