import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const vi: ModelsModelServiceStoreMessages = {
  notMigrated: 'Khóa từ phiên bản 1 chưa được chuyển đổi',
  orderMismatch: 'order phải liệt kê mỗi tài khoản hiện có của nhà cung cấp dịch vụ này đúng một lần',
  credentialNotSaved: (p: { reason: string }) => `Thông tin xác thực chưa được lưu: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} không có tài khoản này: ${p.account}`,
};
