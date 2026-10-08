import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const tr: SpeakersProposalMessages = {
stages: ['Ses izleri', 'Kümelendirme', 'Düzenleme'], nameEmpty: 'Ad boş olamaz', nameTooLong: (max) => `Ad en fazla ${max} karakter olabilir`, receipt: (speakers, duration, engine) => `Uygulandı · ${speakers} konuşmacı bulundu · ${duration} · ${engine}`,
};
