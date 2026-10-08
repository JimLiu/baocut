import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = { failed: 'sentezlenmedi', 'needs-fit': 'çok uzun', stale: 'çeviri güncel değil', draft: 'yerleştirilmedi' } as const;

export const tr: EditorOpsMessages = {
dubStatus: DUB_STATUS, dubStatusCount: (n, status) => `${n} cümle ${DUB_STATUS[status]}`, stemVocals: 'Ayrılmış vokal', stemBackground: 'Ayrılmış arka plan', background: 'Arka plan', sentenceN: (n) => `Cümle ${n}`, dub: 'Dublaj', files: (n) => `${n} dosya`, sentences: (n) => `${n} cümle`, muted: (n) => `${n} cümlenin sesi kapatıldı`, dubTitle: (language) => `Dublaj · ${language ?? 'Bilinmeyen dil'}`, aside: (groups, files) => groups ? `${groups} dublaj grubu · ${files} dosya` : `${files} dosya`,
};
