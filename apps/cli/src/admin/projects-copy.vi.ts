import type { ProjectsMessages } from './projects-copy.ts';

export const vi: ProjectsMessages = {
  help: `Cách dùng:
  baocut projects git-status [<dự án>]
                                   Trạng thái git của dự án: kho, nhánh, BaoCut có commit được không
                                   và vì sao đang tạm dừng (commit bằng baocut projects git-commit)
  baocut projects git-init [<dự án>]
                                   Khởi tạo git trong thư mục dự án (không ở thư mục chính, thư mục người dùng
                                   tiêu chuẩn, gốc của ổ đĩa, hoặc bên trong một kho khác)
  baocut projects git-allow [<dự án>] [--yes]
                                   Hiện các bộ lọc và include trong cấu hình cục bộ của kho rồi cho phép chúng:
                                   chỉ sau đó BaoCut mới chạy các lệnh git thực thi chúng
  <dự án> là ID, tên hoặc thư mục của dự án; nếu không có, dùng dự án chứa thư mục hiện tại`,
  noProject: (cwd) => `Không có dự án nào chứa ${cwd}. Hãy cho ID, tên hoặc thư mục của dự án (baocut projects list)`,
  unknownProject: (text) => `Không tìm thấy dự án: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Có nhiều dự án tên ${text}; hãy dùng ID của nó`,
  states: {
    ready: 'sẵn sàng',
    paused: 'tạm dừng',
    'not-repo': 'không nằm trong kho git',
    unavailable: 'không dùng được git',
    error: 'lỗi',
  },
  head: (name, id) => `Dự án ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Nhánh: ${branch}`,
  detached: 'Nhánh: (HEAD tách rời)',
  version: (version) => `Phiên bản git: ${version}`,
  repo: (root) => `Kho: ${root}`,
  autoCommit: (on) => `Tự động commit: ${on ? 'bật' : 'tắt'}`,
  lastCommit: (commit, auto, at) => `Commit gần nhất: ${commit.slice(0, 12)} (${auto ? 'tự động' : 'thủ công'}, ${at})`,
  lastError: (message) => `Lỗi gần nhất: ${message}`,
  entriesHead: 'Bộ lọc và include cục bộ:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Xem lại rồi chạy baocut projects git-allow để cho phép chúng',
  initDone: (root) => `Đã khởi tạo git trong ${root}`,
  nothingToAllow: 'Kho này không có bộ lọc hay include cục bộ nào đang chờ cho phép',
  allowPrompt: 'Cho phép các mục này? BaoCut sẽ chạy các lệnh git thực thi chúng [y/N] ',
  notTtyAllow: 'Không ở trong terminal: xem các mục bằng baocut projects git-status rồi chạy lại với --yes',
  notAllowed: 'Chưa cho phép: BaoCut vẫn tạm dừng commit trong kho này',
  allowed: 'Đã cho phép: BaoCut commit lại vào kho này',
};
