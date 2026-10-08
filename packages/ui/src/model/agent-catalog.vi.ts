import type { AgentCatalogMessages } from './agent-catalog.ts';

export const vi: AgentCatalogMessages = {
  idEmpty: "Nhập ID, ví dụ my-agent",
  idPattern: "ID phải bắt đầu bằng chữ thường và chỉ dùng chữ thường, chữ số, dấu gạch nối",
  idTooLong: "ID tối đa 63 ký tự",
  idBuiltin: (id,who) => `“${id}” là ID Agent tích hợp của BaoCut${who ? ` (${who})` : ''}. Chọn ID khác`,
  idTaken: (id,who) => `Một Agent${who ? ` (${who})` : ''} đã dùng “${id}”. Chọn ID khác`,
  nameEmpty: "Nhập tên hiển thị trong danh sách",
  nameTooLong: (max) => `Tên tối đa ${max} ký tự`,
  commandEmpty: "Nhập lệnh khởi động, ví dụ my-agent --acp",
  commandShell: "Nhập một lệnh: BaoCut khởi động trực tiếp, không qua shell nên không dùng được pipe, chuyển hướng và &&",
  tooManyArgs: (max) => `Quá nhiều đối số: tối đa ${max}`,
  envLine: (line) => `Dòng ${line} phải có dạng KEY=VALUE, KEY bắt đầu bằng chữ cái hoặc dấu gạch dưới`,
};
