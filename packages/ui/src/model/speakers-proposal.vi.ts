import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const vi: SpeakersProposalMessages = {
stages: ['Dấu giọng', 'Phân cụm', 'Sắp xếp'], nameEmpty: 'Tên không được rỗng', nameTooLong: (max) => `Tên tối đa ${max} ký tự`, receipt: (speakers, duration, engine) => `Đã áp dụng · tìm thấy ${speakers} người nói · ${duration} · ${engine}`,
};
