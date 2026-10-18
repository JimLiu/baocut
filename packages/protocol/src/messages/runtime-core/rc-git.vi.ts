import type { RcGitMessages } from './rc-git.ts';

export const vi: RcGitMessages = {
  gitPurpose: 'Commit các tệp BaoCut của dự án vào git (tùy chọn)',
  gitMissingRemedyMac: 'Cài git: chạy xcode-select --install trong Terminal để có Command Line Tools, hoặc cài bằng Homebrew (brew install git)',
  gitMissingRemedyWin: 'Cài Git for Windows từ https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Cài git bằng trình quản lý gói của bạn',
  xcodeStub: 'Khi chưa cài Command Line Tools, /usr/bin/git chỉ đề nghị cài chúng',

  notRepo: 'Dự án này không nằm trong kho git',
  initRemedy: 'Chạy baocut projects git-init trong thư mục dự án, hoặc tự chạy git init ở nơi bạn muốn đặt kho',
  initHome: 'BaoCut không tạo kho git trong thư mục chính của bạn: với các công cụ khác, mọi thư mục bên trong sẽ trông như thuộc cùng một kho',
  initUserFolder: (p) =>
    `BaoCut không tạo kho git trong thư mục người dùng tiêu chuẩn (${p.path}): với các công cụ khác, mọi thư mục bên trong sẽ trông như thuộc cùng một kho`,
  initVolumeRoot: 'BaoCut không tạo kho git ở thư mục gốc của ổ đĩa hoặc phân vùng',
  initInsideRepo: 'Dự án này đã nằm trong một kho git',
  initElsewhere: 'Hãy chuyển dự án vào thư mục riêng trước, hoặc tự chạy git init ở nơi bạn muốn đặt kho',
  pausedLocked: 'Kho đang được một lệnh git khác sử dụng (có index.lock)',
  lockedRemedy:
    'Hãy để lệnh git kia chạy xong. BaoCut sẽ thử lại ở lần commit sau và không bao giờ xóa tệp khóa; nếu không có lệnh git nào đang chạy, hãy tự xóa tệp khóa',
  pausedMerge: 'Kho đang trong quá trình merge',
  pausedRebase: 'Kho đang trong quá trình rebase',
  pausedCherryPick: 'Kho đang trong quá trình cherry-pick',
  pausedRevert: 'Kho đang trong quá trình revert',
  pausedBisect: 'Kho đang trong quá trình bisect',
  pausedDetached: 'HEAD đang ở trạng thái tách rời (kho không ở nhánh nào)',
  repoStateRemedy: 'Hoàn tất hoặc hủy thao tác đó trong git; sau đó BaoCut sẽ commit lại',
  detachedRemedy: 'Chuyển sang một nhánh trong git; sau đó BaoCut sẽ commit lại',
  pausedLocalConfig:
    'Cấu hình cục bộ của kho chạy chương trình hoặc nạp tệp khác (bộ lọc hoặc include), nên BaoCut không chạy các lệnh git đọc tệp của bạn',
  pausedLocalConfigChanged: 'Bộ lọc hoặc include cục bộ của kho đã thay đổi sau khi bạn cho phép, nên BaoCut lại tạm dừng commit',
  localConfigRemedy: 'Xem các mục và lệnh mà chúng chạy, rồi cho phép bằng baocut projects git-allow',
  gitFailed: (p) => `git gặp lỗi trong kho này: ${p.detail}`,

  manageOnlyInAppOrCli: 'Chỉ ứng dụng máy tính hoặc CLI mới có thể khởi tạo git hay cho phép bộ lọc cục bộ',
  digestChanged: 'Cấu hình cục bộ đã thay đổi sau khi được xem; hãy xem lại các mục',
  commitFailed: (p) => `Commit vào git thất bại: ${p.detail}`,
  initFailed: (p) => `Khởi tạo git thất bại: ${p.detail}`,

  commitSummary: (p) => `Commit các tệp BaoCut trong dự án "${p.name}" vào git`,
  commitTitle: (p) => `BaoCut: cập nhật ${p.names}`,
};
