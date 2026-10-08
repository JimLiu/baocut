import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string { return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''; }
function originalLabel(original: string): string { switch (original) { case 'mute': return 'tắt'; case 'keep': return 'giữ'; default: return 'giảm'; } }
function transcodeAction(action: string): string { switch (action) { case 'merge': return 'Ghép theo thứ tự'; case 'extract-audio': return 'Trích rãnh âm thanh'; default: return 'Nén'; } }

export const vi: RcFlowToolsMessages = {
listSeparator: ', ', transcribeVideoSummary: (p) => `Chép lời ${p.asset ? `tư liệu ${p.asset}` : 'tư liệu trên rãnh chính'}${providerNote(p)}${p.captions ? ' và thêm lớp phụ đề' : ''}`, transcribeFileSummary: (p) => `Chép lời ${p.file}${providerNote(p)} và ghi bản chép lời TXT, SRT vào ${p.outDir ?? 'thư mục Tải xuống'}`, transcribeCreateSummary: (p) => `Tạo video${p.name ? ` “${p.name}”` : ''}, nhập ${p.file} và thêm lên dòng thời gian rồi chép lời${providerNote(p)}${p.captions ? ' và thêm lớp phụ đề' : ''}`, translateVideoSummary: (p) => `Dịch bản chép lời sang ${p.to} bằng mô hình văn bản${providerNote(p)}${p.captions ? ` và thêm lớp phụ đề ${p.bilingual ? 'song ngữ' : ''}` : ''}`, translateFileSummary: (p) => `Dịch tệp phụ đề ${p.input} sang ${p.to} bằng mô hình văn bản${providerNote(p)} và ghi tệp mới vào ${p.outDir ?? 'thư mục Tải xuống'}`, dubSummary: (p) => `Lồng tiếng bản dịch${p.to ? ` (${p.to})` : ''}: ${p.translation ? `dùng bản dịch ${p.translation}` : 'dịch bằng mô hình văn bản trước'}, tổng hợp từng câu${providerNote(p)}${p.voice ? ` với giọng ${p.voice}` : ''}, thêm rãnh lồng tiếng mới và ${originalLabel(p.original)} âm thanh gốc`, transcodeSummary: (p) => `${transcodeAction(p.action)} ${p.count} tệp (${p.files}${p.truncated ? '…' : ''}) và lưu vào ${p.outDir ?? 'thư mục Tải xuống'}`,
  transcribeReplaceSummary: (p) =>
    `Chép lời lại ${p.asset ? `tư liệu ${p.asset}` : 'tư liệu trên rãnh chính'}${providerNote(p)} và thay bản chép lời hiện tại của video, chuyển theo bản dịch, phụ đề và lồng tiếng (một thao tác có thể hoàn tác)`,
};
