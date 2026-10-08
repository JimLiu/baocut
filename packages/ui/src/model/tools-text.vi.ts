import type { ToolsTextMessages } from './tools-text.ts';

export const vi: ToolsTextMessages = {
emptyInput: 'Nhập nội dung muốn tạo trước',
tooLong: (max) => `Tối đa ${max} ký tự mỗi lần`,
sample: 'Viết lời lồng tiếng 30 giây cho video đi dạo trong thành phố. Giữ giọng tự nhiên và nhắc đến đường phố, quán cà phê và hoàng hôn.',
counter: (n, max) => `${n} / ${max} ký tự`,
connectTextModel: 'Kết nối mô hình văn bản trước',
connectFirst: (provider) => `Kết nối ${provider} trước`,
effortFixed: 'Mức suy luận · không thể điều chỉnh cho mô hình này',
effort: (label) => `Mức suy luận · ${label} (mặc định đặt trên trang Mô hình)`,
auto: 'Tự động',
headerChip: (provider) => `Trực tuyến · ${provider} · tính phí theo token`,
fileStem: 'Văn bản đã tạo',
chars: (n) => `${n} ký tự`,
outputTokens: (n) => `${n} token đầu ra`,
truncated: 'Đã đạt giới hạn đầu ra; phần còn lại bị cắt',
};
