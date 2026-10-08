import type { JobsVideoTargetMessages } from './video-target.ts';

export const vi: JobsVideoTargetMessages = {
stepLabel: 'Phân giải đích', notSameVideo: 'chỉ đến video khác với videoId', targetShapeOneOf: 'phải là { videoId }, { entryId } hoặc { create }', createUnsupported: 'Quy trình này không thể tạo video: hãy cung cấp video hiện có (videoId hoặc entryId)', createShape: 'phải là { projectId, name? } hoặc { conversationId, name? }', mediaNotAllowed: 'không được cung cấp: tư liệu là kết quả của quy trình này', unknownField: (p) => `có trường không xác định ${p.key}`, scopeOnlyOne: 'chỉ nhận một trong projectId và conversationId', scopeRequired: 'cần projectId hoặc conversationId', nameLength: 'phải từ 1 đến 200 ký tự', mediaPath: 'phải là đường dẫn tuyệt đối đến tệp tư liệu cục bộ',
};
