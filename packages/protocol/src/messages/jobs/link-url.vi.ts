import type { JobsLinkUrlMessages } from './link-url.ts';

export const vi: JobsLinkUrlMessages = {
startsWithDash: 'Liên kết không được bắt đầu bằng -', invalidLink: 'Liên kết không hợp lệ', httpOnly: 'Chỉ nhận liên kết http(s)://', credentials: 'Liên kết không được chứa tên người dùng hoặc mật khẩu', noHost: 'Liên kết không có tên máy chủ', privateAddress: 'Không thể nhập từ địa chỉ cục bộ, liên kết cục bộ hoặc mạng riêng', redacted: '[liên kết]', unresolvable: (p) => `Không thể phân giải tên máy chủ ${p.host}: kiểm tra mạng và liên kết`, noAddresses: (p) => `Tên máy chủ ${p.host} không có địa chỉ`, resolvesPrivate: (p) => `${p.host} phân giải thành địa chỉ cục bộ, liên kết cục bộ hoặc mạng riêng; không thể nhập từ đó`,
};
