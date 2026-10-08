import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: 'âm thanh', image: 'hình ảnh', doc: 'tài liệu', final: 'tệp video', subtitle: 'phụ đề' };

export const vi: ToolCatalogMessages = {
inputLabels: { file: 'Tệp cục bộ', space: 'Space', link: 'Liên kết', text: 'Văn bản', video: 'Video trong Space', document: 'Tài liệu' },
outputLabels: { video: 'Video', artifact: 'Mục trong Space' }, artifactLabels,
tools: {
transcribe: { name: 'Chép lời', desc: 'Chuyển tệp video hoặc âm thanh thành bản chép lời và phụ đề; với video có thể chỉnh sửa, ghi vào video và thêm lớp phụ đề' },
 'translate-subtitles': { name: 'Dịch phụ đề', desc: 'Dịch phụ đề sang ngôn ngữ khác; với video đã chép lời, thêm bản dịch và lớp phụ đề có thể hiện hai ngôn ngữ, giữ nguyên bản gốc' },
 dub: { name: 'Lồng tiếng bản dịch', desc: 'Thêm lồng tiếng mới từ bản dịch cho video đã chép lời; âm thanh gốc có thể được giảm, tắt hoặc giữ' },
 'synthesize-speech': { name: 'Tạo giọng nói', desc: 'Đọc văn bản hoặc tài liệu và phụ đề trong Space; dùng giọng thiết lập sẵn, nhân bản bản ghi âm hoặc mô tả giọng' },
 'generate-text': { name: 'Tạo văn bản', desc: 'Mô tả nhu cầu rồi gọi trực tiếp mô hình văn bản để tạo nội dung, kịch bản hoặc tóm tắt; có thể đính kèm tài liệu hoặc phụ đề trong Space làm tư liệu' },
 'generate-image': { name: 'Tạo hình ảnh', desc: 'Mô tả hình ảnh rồi vẽ bằng mô hình hình ảnh đám mây hoặc cục bộ; hình tham chiếu, tỷ lệ khung hình và số lượng là tùy chọn' },
 'link-import': { name: 'Tải video', desc: 'Dán liên kết để tải video xuống máy tính này; có thể dùng cookie trình duyệt và chép lời video đã tải thành bản chép lời và phụ đề' },
 'compress-video': { name: 'Nén video', desc: 'Mã hóa lại theo kích thước hoặc chất lượng mục tiêu; thu nhỏ trước khi gửi hoặc tải lên' },
 'merge-video': { name: 'Ghép video', desc: 'Nối nhiều video theo thứ tự thành một tệp' },
 'extract-audio': { name: 'Trích âm thanh', desc: 'Bỏ hình ảnh và chỉ giữ rãnh âm thanh; sao chép nguyên trạng codec âm thanh phổ biến, không mã hóa lại' },
},
targetNone: 'Chỉ tạo bản chép lời và phụ đề', targetCreate: 'Tạo video trong dự án', subtitleFile: 'Tệp phụ đề cục bộ',
groups: {
 speech: { label: 'Giọng nói và phụ đề', desc: 'Chép lời, dịch phụ đề, thêm lồng tiếng và đọc văn bản. Đầu ra là mục tài liệu, phụ đề và âm thanh; chọn video có thể chỉnh sửa trong Space sẽ ghi vào video.' },
 'text-image': { label: 'Văn bản và hình ảnh', desc: 'Gọi trực tiếp mô hình văn bản và hình ảnh. Đầu ra là mục tài liệu và hình ảnh.' },
 'video-file': { label: 'Tệp video', desc: 'Tải xuống, nén, ghép video và trích âm thanh bằng yt-dlp và ffmpeg trên máy tính này. Đầu ra là mục tệp video và âm thanh.' },
},
artifactItems: (artifacts) => artifacts.length ? `mục ${artifacts.map((a) => artifactLabels[a]).join(' và ')}` : 'mục đầu ra',
resultWritesVideo: 'Kết quả: ghi vào video bạn chọn', resultInSpace: (items) => `Kết quả: ${items} trong Space`, resultAlsoCreate: 'cũng có thể tạo video mới', resultWritesEditable: 'ghi vào video có thể chỉnh sửa khi bạn chọn', joinResult: (parts) => parts.join('; '),
};
