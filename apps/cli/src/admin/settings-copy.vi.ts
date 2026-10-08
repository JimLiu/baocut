import type { SettingsMessages } from './settings-copy.ts';

export const vi: SettingsMessages = {
help: `Cách dùng:
  baocut settings                  Liệt kê mọi tùy chọn: khóa, giá trị hiện tại, có phải mặc định và mô tả một dòng
  baocut settings get <key>        In giá trị hiện tại của cài đặt (JSON)
  baocut settings set <key> <value>
                                   Đổi cài đặt; giá trị được phân tích thành JSON (true, 20,
                                   {"cjk":18,"other":40}) hoặc dùng như chuỗi nếu không phân tích được.
                                   Từ chối khóa không xác định và giá trị sai, không lưu gì
  baocut settings reset <key>      Khôi phục giá trị mặc định`,
usage: 'Cách dùng: baocut settings [get <key> | set <key> <value> | reset <key>]',
setUsage: 'Cách dùng: baocut settings set <key> <value> (giá trị được phân tích thành JSON; nội dung không phải JSON dùng như chuỗi; đặt giá trị có dấu cách trong dấu ngoặc kép)',
unknownKey: (key, keys) => `Cài đặt không xác định: ${key}. Có sẵn: ${keys.join(', ')}`, isDefault: 'mặc định', modified: (defaultValue) => `đã đổi (mặc định ${defaultValue})`, settingRejected: (key, value, description) => `${key} không nhận ${value}: ${description}`,
};
