import type { LibraryEntryMessages } from './library-entry.ts';

export const vi: LibraryEntryMessages = {
versionConflict: 'Mục này vừa được đổi ở nơi khác nên chỉnh sửa chưa được lưu. Đã tải lại phiên bản mới nhất. Thực hiện lại chỉnh sửa.', failed: (action, message) => `Không ${action} được: ${message}`,
};
