import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const vi: TextMessages = {
help: `Cách dùng:
  baocut text <prompt> [options]   Gọi mô hình văn bản một lần; lời nhắc - được đọc từ stdin. Văn bản đầy đủ
                                   gửi đến stdout (--out ghi vào tệp, stdout nhận tác vụ và đầu ra dạng
                                   JSON); tiến độ tác vụ, cảnh báo và phiên bản mô hình gửi đến stderr
    --system <text>                Thông điệp hệ thống
    --json-schema <file>           Đầu ra có cấu trúc: trả về và xác thực theo JSON Schema này
                                   (gốc là đối tượng); không khớp thì tác vụ thất bại với MODEL_OUTPUT_INVALID
    --provider <id>                Nhà cung cấp trong danh mục như openai, google, anthropic hoặc custom:<name>;
                                   mặc định nếu bỏ qua (khả năng này không có mặc định có sẵn)
    --model <id>                   Mô hình; mặc định của nhà cung cấp nếu bỏ qua
    --max-output-tokens <n>        Giới hạn đầu ra; giới hạn mô hình nếu bỏ qua. Văn bản thuần bị cắt
                                   vẫn được in với cảnh báo output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Mức suy luận; chọn mức gần nhất nếu mô hình không có mức này,
                                   bỏ qua nếu không điều chỉnh được (giải thích trên stderr)
    --temperature <0–2>            Chỉ dành cho mô hình nhận tham số này
    --seed <n>                     Chỉ dành cho mô hình nhận tham số này
    --out <file>                   Ghi văn bản đầy đủ vào tệp này`,
stdinPromptHint: 'Nhập lời nhắc rồi nhấn Ctrl-D để kết thúc:', missingPrompt: 'Thiếu lời nhắc', jsonSchemaUnreadable: (file, reason) => `Không đọc được JSON Schema ${file}: ${reason}`, jsonSchemaNotObject: 'Tệp --json-schema phải chứa đối tượng JSON', singleModel: 'text chỉ nhận một --model', maxOutputTokensInvalid: '--max-output-tokens phải là số nguyên dương', effortChoices: (efforts) => `--effort phải là một trong ${efforts.join(', ')}`, temperatureRange: '--temperature phải từ 0 đến 2', seedInvalid: '--seed phải là số nguyên', noTextResult: 'Tác vụ hoàn tất nhưng không trả về văn bản', fetchOutputFailed: (artifactId, status) => `Không lấy được đầu ra ${artifactId}: HTTP ${status}`, written: (file) => `Đã ghi ${file}`, modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, đầu vào ${usage.input} / đầu ra ${usage.output} token` : ''}`,
};
