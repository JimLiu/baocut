import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const vi: ModelsImageSelfTestMessages = {
notPng: 'Không phải tệp PNG', chunkTruncated: (p) => `Khối ${p.type} bị cắt`, missingIhdr: 'Thiếu khối IHDR', unsupportedPixelFormat: (p) => `Định dạng điểm ảnh không được hỗ trợ (độ sâu bit ${p.depth}, loại màu ${p.color}, xen kẽ ${p.interlace})`, zeroSize: 'Chiều rộng hoặc chiều cao bằng 0', missingIdat: 'Thiếu khối IDAT', inflateFailed: 'Không giải nén được dữ liệu điểm ảnh', pixelDataShort: 'Không đủ dữ liệu điểm ảnh', unknownFilter: 'Loại bộ lọc hàng không xác định', undecodable: (p) => `Không thể giải mã đầu ra: ${p.problem}`, sizeMismatch: (p) => `Kích thước ${p.width}×${p.height} không phải ${p.expectedWidth}×${p.expectedHeight} đã yêu cầu`, nearlySolid: (p) => `Hình ảnh gần như chỉ có một màu (chỉ ${p.distinct} màu)`,
};
