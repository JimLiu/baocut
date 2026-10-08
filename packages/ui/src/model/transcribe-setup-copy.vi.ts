import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const vi: TranscribeSetupMessages = {
notConnected: 'Chưa kết nối', unavailable: 'Không khả dụng', autoDetect: 'Tự động phát hiện',
hintNoModel: 'Chưa biết sẽ dùng mô hình giọng nói nào. Chọn một mô hình ở trên để xem có nhận gợi ý nhận dạng hay không.',
hintUnsupported: (model, alt) => `${model} không nhận gợi ý nhận dạng nên bảng thuật ngữ và lời nhắc không dùng được ở bước này và sẽ bị bỏ qua khi chép lời.${alt ? ` Để dùng khi chép lời, hãy chuyển sang ${alt}.` : ''}`,
budget: (model, b, max) => {
 const custom = b.custom ? `lời nhắc ${b.custom} ký tự` : 'không có lời nhắc';
 const dropped = b.dropped ? ` · còn ${b.dropped} mục không đủ chỗ; bảng thuật ngữ xếp trước được đưa vào trước` : '';
 return `Gửi đến ${model}: ${custom} + ${b.terms} thuật ngữ · khoảng ${b.chars} / ${max} ký tự${dropped}`;
},
glossaryGone: 'Không còn trong thư viện bảng thuật ngữ · không dùng lần này',
glossaryTranslation: 'Bảng thuật ngữ dịch; không dùng để chép lời · không dùng lần này',
anyLanguage: 'Ngôn ngữ bất kỳ', termCount: (count) => `${count} thuật ngữ`,
noDefaultModel: 'Chưa có mô hình giọng nói mặc định', defaultModel: (label) => `${label} (mặc định)`,
autoDetectLanguage: 'Tự động phát hiện ngôn ngữ', glossaries: (count) => `${count} bảng thuật ngữ`, hasPrompt: 'Có lời nhắc',
noDefaultFacts: 'Chưa có mô hình giọng nói mặc định. Chọn một mô hình hoặc đặt mặc định trên trang Mô hình. Nếu bắt đầu mà không chọn, bạn sẽ được báo phần còn thiếu.',
modelUnusable: 'Hiện không dùng được mô hình này', acceptsHint: 'Nhận gợi ý nhận dạng', noHint: 'Không nhận gợi ý nhận dạng', followDefault: (facts) => `Dùng mặc định · ${facts}`,
};
