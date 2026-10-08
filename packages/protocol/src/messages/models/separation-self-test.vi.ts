import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const vi: ModelsSeparationSelfTestMessages = {
vocals: 'rãnh giọng hát', background: 'rãnh nền', vocalsUndecodable: (p) => `Không thể giải mã rãnh giọng hát: ${p.problem}`, backgroundUndecodable: (p) => `Không thể giải mã rãnh nền: ${p.problem}`, notStereo: (p) => `${p.stem} không phải stereo (${p.channels} kênh)`, durationMismatch: (p) => `${p.stem} dài ${p.duration} giây nhưng mẫu dài ${p.sample} giây`, sampleRateMismatch: (p) => `Hai rãnh có tần số lấy mẫu khác nhau (${p.vocals} và ${p.background})`, vocalsSilent: 'Rãnh giọng hát không có âm thanh', vocalsNotLouder: (p) => `Mẫu chỉ có giọng nói nhưng rãnh giọng hát không rõ ràng lớn hơn nền (RMS ${p.vocals} và ${p.background})`,
};
