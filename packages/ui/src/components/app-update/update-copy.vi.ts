import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {'install': 'bắt đầu cài', 'check': 'kiểm tra cập nhật', 'download': 'bắt đầu tải', 'cancel': 'hủy tải', 'retry': 'thử lại', 'downloadPage': 'mở trang tải'};

export const vi: UpdateMessages = {
failed: (step, message) => `Không ${STEP[step]} được: ${message}`, progress: 'Tiến độ tải', notes: 'Điểm mới trong phiên bản này', close: 'Đóng',
};
