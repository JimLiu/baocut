import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const tr: ModelsSpeechSelfTestMessages = {
notWav: 'RIFF/WAVE dosyası değil', missingFmt: "Fmt bloğu eksik", missingData: "Data bloğu eksik", unsupportedEncoding: (p) => `Desteklenmeyen kodlama (${p.format})`, badChannels: (p) => `Geçersiz kanal sayısı (${p.channels})`, badSampleRate: (p) => `Geçersiz örnekleme hızı (${p.sampleRate})`, unsupportedBitDepth: (p) => `Desteklenmeyen bit derinliği (${p.bits})`, nonFinite: 'Örneklerde sonlu olmayan değerler var', undecodable: (p) => `Çıktı çözümlenemiyor: ${p.problem}`, durationOutOfRange: (p) => `${p.duration} saniyelik süre ${p.min}–${p.max} saniye arasında değil`, silent: 'Çıktı sessiz', clipped: (p) => `Çıktıda kırpılma var: örneklerin %${p.ratio} oranı tam ölçeğe ulaşıyor (sınır %${p.limit})`,
};
