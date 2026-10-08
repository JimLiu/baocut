import type { FontsMessages } from './fonts-copy.ts';

export const vi: FontsMessages = {
help: `Cách dùng:
  baocut fonts [downloaded]        Phông chữ đã tải (Google Fonts, tải theo nhu cầu):
                                   họ phông, độ đậm, kích thước, giấy phép và tổng kích thước
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Danh sách chọn phông: họ phông kèm ứng dụng, trên máy tính này và trong danh mục
                                   cùng trạng thái (có sẵn, trên máy này, đã tải, có thể tải,
                                   đang tải, thất bại). Danh mục: sans-serif, serif, display, handwriting,
                                   monospace; hệ chữ: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Tải họ phông (mặc định thường và đậm); tiến độ gửi đến stderr, Ctrl-C
                                   hủy. Chỉ gửi tên họ phông và độ đậm; mirror xem cài đặt
                                   fonts.cssEndpoint và fonts.fileEndpoint; từ chối trong chế độ ngoại tuyến nghiêm ngặt
  baocut fonts remove <family>     Xóa phông đã tải của họ này (từ chối nếu bản xuất chưa hoàn tất đang dùng)
  baocut fonts clear               Xóa phông đã tải (giữ phông mà bản xuất chưa hoàn tất đang dùng)`,
alreadyDownloaded: (family) => `“${family}” đã được tải xuống`, downloadDone: 'Tải xuống hoàn tất', remedy: (text) => `Cách khắc phục: ${text}`, usage: 'Cách dùng: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear', listSep: ', ', categoryChoices: (choices) => `--category phải là một trong ${choices.join(', ')}`, scriptChoices: (choices) => `--script phải là một trong ${choices.join(', ')}`, limitRange: '--limit phải là số nguyên từ 1 đến 500', italicNeedsWeights: '--italic dùng cùng --weights', weightsFormat: '--weights nhận độ đậm từ 1 đến 1000, cách nhau bằng dấu phẩy', stateLabels: { 'built-in': 'Có sẵn', installed: 'Trên máy tính này', downloaded: 'Đã tải xuống', downloadable: 'Có thể tải xuống', downloading: 'Đang tải xuống', failed: 'Thất bại', unavailable: 'Không khả dụng' }, face: (weight, italic) => `${weight}${italic ? ' nghiêng' : ''}`, noDownloads: 'Chưa có phông đã tải', downloadedTotal: (families, faces, size) => `${families} họ phông, ${faces} độ đậm, tổng ${size}`, noMatches: 'Không có phông khớp', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(tổng ${total}, hiện ${shown} mục đầu)`, removed: (count, freed) => `Đã xóa ${count} độ đậm, giải phóng ${freed}`, nothingToRemove: 'Không có phông để xóa', kept: (count, faces) => `Đã giữ ${count} (bản xuất chưa hoàn tất đang dùng): ${faces.join(', ')}`,
};
