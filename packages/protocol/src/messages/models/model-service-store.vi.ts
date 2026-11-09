import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const vi: ModelsModelServiceStoreMessages = {
  notMigrated: 'Khóa từ phiên bản 1 chưa được chuyển đổi',
  orderMismatch: 'order phải liệt kê mỗi tài khoản hiện có của nhà cung cấp dịch vụ này đúng một lần',
  credentialNotSaved: (p: { reason: string }) => `Thông tin xác thực chưa được lưu: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} không có tài khoản này: ${p.account}`,
  accountLinked: (p: { home: string }) => `Tài khoản này được liên kết từ ${p.home}; hãy đổi hoặc xóa khóa của nó ở đó`,
  linkSameHome: 'Không thể liên kết tài khoản từ cùng một thư mục BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} lưu khóa trong một tệp, không phải trong chuỗi khóa của hệ thống; chỉ liên kết được thư mục dùng chuỗi khóa`,
  linkSourceEmpty: (p: { home: string }) => `Không tìm thấy cài đặt dịch vụ mô hình BaoCut trong ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} không có tài khoản nào khớp`,
  linkedHelperMissing: (p: { home: string }) => `Không đọc được khóa của các tài khoản liên kết từ ${p.home}: không tìm thấy trình trợ giúp thông tin xác thực của ứng dụng BaoCut đã cài`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Tài khoản liên kết ${p.account} không còn trong ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `Khóa của tài khoản liên kết ${p.account} (từ ${p.home}) không có trong chuỗi khóa của hệ thống`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Không đọc được khóa của tài khoản liên kết ${p.account} (từ ${p.home}): ${p.reason}`,
};
