import type { SpeakersProposalMessages } from './speakers-proposal.ts';
import { pluralForm } from '@baocut/protocol';
export const es: SpeakersProposalMessages = {
 stages: ['Huellas de voz', 'Agrupación', 'Organización'], nameEmpty: 'El nombre no puede estar vacío',
 nameTooLong: (max) => `Los nombres pueden tener como máximo ${max} caracteres`,
 receipt: (speakers, duration, engine) => `Aplicado · ${pluralForm('es', speakers, { one: `Se encontró ${speakers} hablante`, other: `Se encontraron ${speakers} hablantes` })} · ${duration} · ${engine}`,
};
