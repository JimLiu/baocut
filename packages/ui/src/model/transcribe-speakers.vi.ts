import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const vi: TranscribeSpeakersMessages = {
packFallback: 'Phân biệt người nói',
builtinNote: (model) => `${model} tự phân biệt người nói trong khi chép lời`,
builtinSummary: 'Nhận dạng người nói · có sẵn trong mô hình',
noneNote: (model) => `${model} không phân biệt người nói. Nếu cần, hãy chuyển sang mô hình cục bộ hoặc dịch vụ có sẵn tính năng này`,
missingNote: (pack, size) => `Tải xuống “${pack}”${size ? ` (${size})` : ''} trước để phân biệt người nói`,
missingSummary: 'Nhận dạng người nói · tải mô hình trước',
onNote: 'Sau khi chép lời, “Phân biệt người nói” gắn nhãn người nói cho từng câu; phụ đề và bản chép lời sẽ có tên',
summaryOn: 'Nhận dạng người nói',
offNote: 'Không phân biệt người nói; phụ đề và bản chép lời sẽ không có tên',
summaryOff: 'Không nhận dạng người nói',
downloading: (pack, pct) => `Đang tải xuống “${pack}”${pct === null ? '…' : ` · ${pct}%`}`,
};
