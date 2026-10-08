import type { ToolUpdateMessages } from './tool-update.ts';

export const vi: ToolUpdateMessages = {
standalone: 'Chương trình độc lập chính thức',
updateInTerminal: 'Cập nhật trong Terminal',
unknownInstall: 'Không xác định được cách cài yt-dlp này. Chạy lệnh phù hợp với cách bạn đã cài, rồi nhấp “Kiểm tra lại”.',
cannotRun: 'BaoCut không thể chạy lệnh này giúp bạn.',
thenRecheck: 'Sau đó nhấp “Kiểm tra lại”.',
runThenRecheck: 'Chạy lệnh này trong Terminal, rồi nhấp “Kiểm tra lại”.',
updateWith: (method) => `Cập nhật bằng ${method}`,
stoppedTitle: 'Đã dừng cập nhật',
stoppedBody: 'Lệnh có thể chỉ chạy một phần. Xem đầu ra bên dưới rồi nhấp “Kiểm tra lại” để xác nhận phiên bản yt-dlp hiện tại.',
failedTitle: (exitCode) => exitCode === null ? 'Cập nhật chưa hoàn tất' : `Cập nhật chưa hoàn tất (mã thoát ${exitCode})`,
failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}yt-dlp hiện có không bị ảnh hưởng. Đầu ra ở bên dưới; bạn cũng có thể sao chép lệnh, chạy trong Terminal rồi nhấp “Kiểm tra lại”.`,
updatedTo: (version) => `Đã cập nhật lên ${version}`,
upToDate: (version) => version ? `Đã là bản mới nhất (${version})` : 'Đã là bản mới nhất',
logTruncated: '… (đã lược đầu ra trước đó; đầu ra đầy đủ trong bản ghi tác vụ)\n',
logStopped: '(Đã dừng)',
logExitCode: (exitCode) => `(Mã thoát ${exitCode})`,
};
