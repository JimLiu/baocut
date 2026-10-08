import type { NewFlowMessages } from './new-flow.ts';

export const vi: NewFlowMessages = {
bilibili: 'Bilibili', directLink: 'Liên kết trực tiếp', webPage: 'Trang web', videoLink: (site) => `Liên kết video ${site}`, into: (name) => `Dịch sang ${name}`, translated: (language) => `Đã dịch xong · phụ đề ${language} đã có trên video`,
};
