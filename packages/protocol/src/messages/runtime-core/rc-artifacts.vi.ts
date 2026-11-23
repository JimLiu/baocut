import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const vi: RcArtifactsMessages = {
  unavailable: "Không dùng được tác phẩm: Open Artifact không khởi động được.",
  unavailableBecause: (p: { reason: string }) => `Không dùng được tác phẩm: ${p.reason}`,
  notFound: "Không tìm thấy tác phẩm này. Có thể nó đã bị xóa.",
  viewGone: "Chế độ xem tác phẩm này đã đóng. Hãy mở lại tác phẩm.",
  confirmAction: (p: { tool: string; action: string }) => `Chạy “${p.action}” trên tác phẩm (${p.tool})`,
  skillName: "Tác phẩm",
  skillSummary: "Tạo trang chiếu, tài liệu, thiết kế, bảng tính và hơn nữa bằng Open Artifact",
};
