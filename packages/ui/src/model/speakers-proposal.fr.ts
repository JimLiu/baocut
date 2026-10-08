import { pluralForm } from '@baocut/protocol';
import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const fr: SpeakersProposalMessages = {
  stages: ["Empreintes vocales", "Regroupement", "Organisation"] as readonly string[],
  nameEmpty: "Nom non vide requis",
  nameTooLong: (max: number) => `Noms de longueur maximale ${max} caractères`,

  receipt: (speakers: number, duration: string, engine: string) =>
    `Appliqué · trouvé ${speakers} ${pluralForm('fr', speakers, { one: "locuteur", other: "locuteurs" })} · ${duration} · ${engine}`,
};
