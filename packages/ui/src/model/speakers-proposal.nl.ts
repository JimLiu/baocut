import type { SpeakersProposalMessages } from './speakers-proposal.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: SpeakersProposalMessages = { stages: ['Stemafdrukken', 'Clusteren', 'Ordenen'], nameEmpty: 'De naam mag niet leeg zijn', nameTooLong: (max) => `Namen mogen maximaal ${max} tekens bevatten`, receipt: (speakers, duration, engine) => `Toegepast · ${speakers} ${pluralForm('nl', speakers, { one: 'spreker gevonden', other: 'sprekers gevonden' })} · ${duration} · ${engine}` };
