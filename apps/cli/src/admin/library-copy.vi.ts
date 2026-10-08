import type { LibraryMessages } from './library-copy.ts';

export const vi: LibraryMessages = {
help: `Cách dùng:
  baocut library import <file>     Nhập tệp trao đổi, nhận dạng loại theo nội dung (không theo phần mở rộng):
                                   bảng thuật ngữ Markdown, gói giọng .bcvoice, JSON màu và kiểu phụ đề
                                   của bộ thương hiệu, nhãn dán Lottie, hình ảnh, video, phông chữ
  baocut library export <library> <id> <path>
                                   Xuất phiên bản hiện tại: bảng thuật ngữ thành Markdown, giọng thành .bcvoice,
                                   tư liệu thương hiệu thành tệp gốc; không ghi đè đích hiện có
  baocut library remove <library> <id>
                                   Xóa mục (không ảnh hưởng nội dung đã sao chép vào video)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Tải bản ghi tham chiếu của giọng lên nhà cung cấp để nhân bản
                                   (hiện chỉ elevenlabs): cần tuyên bố cho phép và ủy quyền chia sẻ dữ liệu
                                   gồm audio (baocut grants create); chạy như tác vụ, Ctrl-C hủy
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Xóa bản nhân: yêu cầu nhà cung cấp xóa trước, thành công thì xóa bản ghi;
                                   --local-only chỉ xóa bản ghi cục bộ
  baocut library video-selection <video id> [options]
                                   Mục thư viện bật trong video (lưu trong video, có thể hoàn tác): hiển thị nếu không có
                                   tùy chọn; phần đã cung cấp được thay toàn bộ, phần còn lại giữ nguyên.
                                   Video mới tự bật bảng thuật ngữ có đánh dấu bật mặc định trong thư viện
    --transcribe-glossaries <id,…> Bảng thuật ngữ chép lời (dùng khi chép lời không chỉ định);
                                   chuỗi rỗng xóa danh sách
    --translate-glossaries <id,…>  Bảng thuật ngữ dịch (dùng cho translate và bản dịch của dub);
                                   chuỗi rỗng xóa danh sách
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Giọng người nói (có thể lặp, thay toàn bộ):
                                   library:<id> hoặc ID giọng của nhà cung cấp (kèm @Provider)
    --clear-speaker-voices         Xóa giọng người nói`,
importUsage: 'Cách dùng: baocut library import <file>', exportUsage: 'Cách dùng: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Cách dùng: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Cách dùng: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Cách dùng: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Cách dùng: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…', imported: (label, id, name) => `Đã nhập vào ${label}: ${id}  ${name}`, exported: (id, version, file, bytes) => `Đã xuất ${id} phiên bản ${version} vào ${file} (${bytes} byte)`, deleted: (id) => `Đã xóa ${id}`, remoteCloneOutcome: { deleted: 'đã xóa từ xa', 'not-found': 'giọng đã mất từ xa', skipped: 'chưa liên hệ từ xa' }, voiceCloneRemoved: (id, provider, remote) => `Đã xóa bản nhân của ${id} trên ${provider} (${remote})`, libraryLabels: { glossaries: 'Bảng thuật ngữ', voices: 'Giọng', brand: 'Bộ thương hiệu' }, unknownLibrary: (text) => `Không có thư viện này: ${text ?? '(thiếu)'}. Có sẵn: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice nhận <transcript id>:<speaker>=<voice>[@<Provider>]; nhận được ${text}`, listSep: ', ', none: '(không có)', selectionHead: (videoId, documentId, revision) => `Video ${videoId}${documentId ? ` (tài liệu library-selection ${documentId} phiên bản ${revision})` : ' (chưa bật gì)'}`, transcribeGlossaries: (list) => `Bảng thuật ngữ chép lời: ${list}`, translateGlossaries: (list) => `Bảng thuật ngữ dịch: ${list}`, speakerVoicesNone: 'Giọng người nói: (không có)', speakerVoice: (documentId, speakerId, voice, providerId) => `Giọng người nói: ${documentId}:${speakerId} = ${voice}${providerId ? ` (chỉ trên ${providerId})` : ''}`,
};
