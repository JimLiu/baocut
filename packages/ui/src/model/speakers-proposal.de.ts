import { pluralForm } from '@baocut/protocol';
import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const de: SpeakersProposalMessages = {
  stages: ["Stimmabdrücke", "Clustering", "Wird aufgeräumt"] as readonly string[],
  nameEmpty: "Name darf nicht leer sein",
  nameTooLong: (max: number) => `Namen dürfen höchstens enthalten: ${max} Zeichen`,

  receipt: (speakers: number, duration: string, engine: string) =>
    `Angewendet · Gefunden: ${speakers} ${pluralForm('de', speakers, { one: "Sprecher", other: "Sprecher" })} · ${duration} · ${engine}`,
};
