import type { TemplatesMessages } from './templates-copy.ts';

export const vi: TemplatesMessages = {
help: `Cách dùng:
  baocut templates                 Liệt kê mẫu tạo khả dụng (có sẵn và trong <BAOCUT_HOME>/templates),
                                   cùng thư mục mẫu tải thất bại và lý do
  baocut templates show <id>       Hiện điểm chính trong bản kê của mẫu và toàn bộ prompt.md`,
kindLabels: { scene: 'Mẫu cảnh', example: 'Ví dụ' }, originLabels: { builtin: 'Có sẵn', user: 'Người dùng' }, spec: (ratio, seconds) => `${ratio ?? 'tỷ lệ tự động'} · ${seconds ? `${seconds} giây` : 'thời lượng tự động'}`, summaryLine: (title, summary) => `${title}: ${summary}`, diagnosticHead: (origin, dir, code, message) => `Mẫu ${origin} ${dir} (${code}): ${message}`, folder: (path) => `  Thư mục: ${path}`, none: 'Không có mẫu khả dụng', skipped: (n) => `Đã bỏ qua ${n} thư mục mẫu:`, detailHead: (title, id, version, kind, origin) => `${title} (${id} v${version}, ${kind}, ${origin})`, meta: (category, spec, language) => `Danh mục: ${category}  Tỷ lệ và thời lượng: ${spec}  Ngôn ngữ: ${language}`, author: (author, source, license) => `Tác giả: ${author} (${source}, ${license})`, tags: (tags) => `Thẻ: ${tags.join(', ')}`, sample: (sample) => `Thử nói: ${sample}`, cover: (file) => `Bìa: ${file}`, preview: (file) => `Xem trước: ${file}`, asset: (path, type, note) => `Tư liệu: ${path} (${type})${note ? ` ${note}` : ''}`, verification: (v) => `Đã xác minh: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, bản xuất ${v.output.ratio} · ${v.output.seconds} giây` : ''}${v.missing.length ? `, thiếu ${v.missing.join(', ')}` : ''}`, templateFlag: (value) => `--template nhận id mẫu (kebab-case, xem baocut templates): ${value}`,
};
