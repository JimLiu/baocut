import type { SandboxMessages } from './sandbox-copy.ts';

export const vi: SandboxMessages = {
  help: `Cách dùng:
  baocut sandbox create <thư mục> [--link-accounts-from <home>]
                                   Dựng một thư mục Runtime riêng cho phát triển và kiểm thử: thư mục đó cùng thư mục
                                   projects bên trong, một bin/baocut chạy CLI của bản sao kho mã này trên thư mục đó, và
                                   env.sh / env.ps1 để chuyển một shell sang nó. Chạy lại để làm mới các tệp này. Chỉ chạy
                                   từ một bản sao kho mã; không bao giờ là ~/.baocut mặc định
    --link-accounts-from <home>    Đồng thời liên kết chỉ đọc các tài khoản mô hình của thư mục đó (thường là ~/.baocut),
                                   như baocut models accounts link --from. Các lệnh gọi dùng tài khoản thật của bạn và bị tính phí`,
  defaultHome: (dir) => `${dir} là thư mục Runtime mặc định, chứa dữ liệu thật của bạn; hãy chọn thư mục khác cho sandbox`,
  needsSourceCli:
    'baocut sandbox create chỉ chạy từ một bản sao kho mã (node apps/cli/src/main.ts sandbox create …). CLI này khởi động Runtime của ứng dụng BaoCut, vốn giữ khóa trong chuỗi khóa hệ thống dùng chung cho mọi thư mục: tạo sandbox ở đó có thể ghi đè hoặc xóa khóa thật của bạn',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY trỏ tới ${entry}, và không rõ Runtime đó giữ khóa ở đâu. Hãy bỏ biến này trước khi tạo sandbox`,
  notEmpty: (dir) => `${dir} đã có tệp và không phải thư mục BaoCut; hãy chọn thư mục mới hoặc trống`,
  notFolder: (dir) => `${dir} không phải thư mục`,
  created: (dir) => `Sandbox đã sẵn sàng: ${dir}`,
  refreshed: (dir) => `Đã làm mới sandbox: ${dir}`,
  projects: (dir) => `  Dự án     ${dir}`,
  cli: (file) => `  baocut    ${file} (chạy CLI của bản sao này)`,
  useHeader: 'Để dùng trong một shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Sau đó baocut trong shell đó và các agent khởi động từ nó dùng sandbox; các shell khác vẫn dùng ~/.baocut. Runtime của nó giữ khóa trong một tệp bên trong sandbox',
  linkFailed: (dir) => `Sandbox tại ${dir} đã sẵn sàng; liên kết tài khoản không thành công:`,
};
