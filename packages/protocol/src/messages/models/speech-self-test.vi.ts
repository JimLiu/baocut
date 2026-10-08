import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const vi: ModelsSpeechSelfTestMessages = {
notWav: 'Không phải tệp RIFF/WAVE', missingFmt: 'Thiếu khối fmt', missingData: 'Thiếu khối data', unsupportedEncoding: (p) => `Mã hóa không được hỗ trợ (${p.format})`, badChannels: (p) => `Số kênh không hợp lý (${p.channels})`, badSampleRate: (p) => `Tần số lấy mẫu không hợp lý (${p.sampleRate})`, unsupportedBitDepth: (p) => `Độ sâu bit không được hỗ trợ (${p.bits})`, nonFinite: 'Mẫu chứa giá trị không hữu hạn', undecodable: (p) => `Không thể giải mã đầu ra: ${p.problem}`, durationOutOfRange: (p) => `Thời lượng ${p.duration} giây không trong khoảng ${p.min}–${p.max} giây`, silent: 'Đầu ra không có âm thanh', clipped: (p) => `Đầu ra bị cắt ngọn: ${p.ratio}% mẫu đạt toàn thang (giới hạn ${p.limit}%)`,
};
