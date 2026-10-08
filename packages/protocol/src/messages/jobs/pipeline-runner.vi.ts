import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const vi: JobsPipelineRunnerMessages = {
unknownPipeline: (p) => `Không có quy trình tên “${p.name}”`, entryTargetUnsupported: 'Runtime này không thể mở video từ mục Space', targetMismatch: 'Tham số target và videoId chỉ đến hai video khác nhau', noLibrary: 'Runtime này không có thư viện người dùng', notPipeline: 'Tác vụ này không phải quy trình', notRetryable: 'Chỉ có thể thử lại quy trình thất bại, đã hủy hoặc bị gián đoạn', pipelineMissing: (p) => `Runtime này không có quy trình tên “${p.name}”`, alreadyRetrying: 'Quy trình đang được thử lại', cannotOpenTarget: 'Runtime này không thể mở video đích của quy trình', targetReplaced: 'Vị trí đích hiện có video khác. Bắt đầu lại.', pipelineFailed: 'Quy trình gặp lỗi', stepFailed: 'Bước gặp lỗi', interrupted: 'Runtime đã dừng trước khi quy trình hoàn tất. Dùng pipelines.retry để tiếp tục từ bước đã dừng.', subtask: (p) => `${p.step}: ${p.label}`,
};
