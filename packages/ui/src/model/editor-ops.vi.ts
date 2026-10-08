import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = { failed: 'chưa tổng hợp', 'needs-fit': 'quá dài', stale: 'bản dịch lỗi thời', draft: 'chưa đặt' } as const;

export const vi: EditorOpsMessages = {
dubStatus: DUB_STATUS, dubStatusCount: (n, status) => `${n} câu ${DUB_STATUS[status]}`, stemVocals: 'Giọng đã tách', stemBackground: 'Nền đã tách', background: 'Nền', sentenceN: (n) => `Câu ${n}`, dub: 'Lồng tiếng', files: (n) => `${n} tệp`, sentences: (n) => `${n} câu`, muted: (n) => `${n} câu đã tắt tiếng`, dubTitle: (language) => `Lồng tiếng · ${language ?? 'Ngôn ngữ không xác định'}`, aside: (groups, files) => groups ? `${groups} nhóm lồng tiếng · ${files} tệp` : `${files} tệp`,
};
