import type { EditorMessages } from './editor.ts';

export const vi: EditorMessages = {
trackKind: { visual: 'Hình ảnh', audio: 'Âm thanh', subtitle: 'Phụ đề' }, counter: 'Bộ đếm', text: 'Văn bản', shape: 'Hình dạng', composition: 'Bố cục', caption: 'Phụ đề', asset: 'Tư liệu', elements: { sticker: 'Nhãn dán', placeholder: 'Chỗ giữ', whiteboard: 'Bảng trắng', progress: 'Thanh tiến độ', visualizer: 'Dạng sóng', confetti: 'Giấy vụn', draw: 'Hình vẽ' }, seconds: (value) => `${value} giây`,
};
