import type { ModelsEmbeddingMessages } from './embedding.ts';

export const vi: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: dùng miễn phí, kể cả thương mại; khi phân phối lại phải giữ thông báo bản quyền và giấy phép',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM chưa có bản dựng cho máy này (${p.platform}), nên tại đây chưa dùng được tìm kiếm ngữ nghĩa cục bộ`,
  runtimeNotInstalled: (p: { version: string }) => `Chưa cài LiteRT-LM ${p.version}`,
  countMismatch: (p: { expected: number; actual: number }) => `Cần ${p.expected} vectơ nhưng nhận được ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `Có vectơ ${p.actual} chiều thay vì ${p.expected} chiều`,
  notFinite: 'Có vectơ chứa giá trị không phải số hữu hạn',
  notNormalized: (p: { norm: string }) => `Có vectơ không có độ dài 1 (chuẩn ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `Câu liên quan không có điểm cao hơn câu không liên quan (cosin ${p.relevant} so với ${p.irrelevant})`,
  noModel: 'Chưa cài mô hình embedding cục bộ',
  noVisionModel: 'Không mô hình embedding cục bộ nào đã cài đọc được hình ảnh. Hãy cài EmbeddingGemma 2 740M để tìm theo nội dung hình',
  inputTooLong: (p: { index: number; max: number }) => `Đoạn văn ${p.index} dài hơn mức mô hình nhận được (${p.max} token)`,
  modelUnavailable: (p: { problem: string }) => `Không dùng được mô hình embedding cục bộ: ${p.problem}`,
  cannotEmbed: 'Model Worker này chưa tính được embedding bằng mô hình này',
  embedReturned: (p: { code: string }) => `embed.run trả về ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} chiều · cosin ${p.relevant} so với ${p.irrelevant} · ${p.device}`,
};
