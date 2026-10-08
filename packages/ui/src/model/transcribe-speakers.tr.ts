import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const tr: TranscribeSpeakersMessages = {
packFallback: 'Konuşmacı ayrımı',
builtinNote: (model) => `${model} yazıya dökme sırasında konuşmacıları kendisi ayırt eder`,
builtinSummary: 'Konuşmacıları belirle · modele yerleşik',
noneNote: (model) => `${model} konuşmacıları ayırt etmez. Gerekirse yerel bir modele veya bu özelliği yerleşik olan bir hizmete geçin`,
missingNote: (pack, size) => `Konuşmacıları ayırt etmek için önce “${pack}” indirin${size ? ` (${size})` : ''}`,
missingSummary: 'Konuşmacıları belirle · önce modeli indirin',
onNote: 'Yazıya dökmeden sonra “Konuşmacı ayrımı” her cümleyi konuşmacısıyla etiketler; altyazı ve dökümler adları içerir',
summaryOn: 'Konuşmacıları belirle',
offNote: 'Konuşmacılar ayırt edilmez; altyazı ve dökümler adları içermez',
summaryOff: 'Konuşmacıları belirleme',
downloading: (pack, pct) => `“${pack}” indiriliyor${pct === null ? '…' : ` · %${pct}`}`,
};
