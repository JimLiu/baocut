import type { VoicePickerMessages } from './voice-picker.ts';

export const vi: VoicePickerMessages = {
clonedOn: (provider) => `Đã nhân bản trên ${provider} · tổng hợp bằng bản này`,
defaultVoice: 'Giọng mặc định',
providerPreset: (provider, name) => `${name} của ${provider}`,
loadingMine: 'Đang tải Giọng của tôi…',
cloneNew: 'Nhân bản giọng mới…',
cloneNewHint: 'Ghi âm hoặc nhập từ tệp trong Cài đặt › Mô hình › Tổng hợp giọng nói › Giọng của tôi',
myVoices: 'Giọng của tôi',
providerVoices: (provider) => `Giọng của ${provider}`,
customVoice: 'Nhập ID giọng…',
customVoiceHint: 'ID giọng từ tài khoản nhà cung cấp của bạn',
tempReference: 'Dùng bản ghi âm một lần…',
tempReferenceHint: 'API tổng hợp của phiên bản này chưa nhận bản ghi tham chiếu dùng một lần · lưu vào Giọng của tôi và nhân bản trước',
other: 'Khác',
voiceDeleted: 'Giọng này đã bị xóa · chọn giọng khác hoặc trở về mặc định',
customLine: 'Gửi nguyên trạng để nhà cung cấp kiểm tra; bạn cũng có thể tạo giọng nhân bản trong Giọng của tôi rồi chọn',
presetLine: (provider, voiceId) => voiceId === null ? `Giọng của ${provider}` : `Giọng của ${provider} · ${voiceId}`,
defaultLine: (provider, name) => `Nếu không chọn, sẽ dùng giọng mặc định của ${provider} (${name})`,
noDefault: 'Mô hình này không có giọng mặc định; chọn một giọng trước',
};
