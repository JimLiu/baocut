import type { StandaloneMessages } from './standalone-copy.ts';

export const vi: StandaloneMessages = {
  cliHelp: `Cách dùng:
  baocut cli install               Cài gói dòng lệnh này cho người dùng hiện tại và đặt baocut vào PATH. Gói được sao chép
                                   tới ~/.local/share/baocut/versions/<phiên bản> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<phiên bản>), trừ khi đã có sẵn ở đó. macOS: liên kết
                                   tại ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, kèm thư mục đó
                                   được thêm vào PATH của người dùng. Không cần quyền quản trị
  baocut cli status                baocut nằm ở đâu, trỏ tới phiên bản đã cài nào, và terminal của bạn tìm thấy baocut nào
  baocut cli remove                Gỡ những gì baocut cli install đã đặt; các phiên bản đã cài vẫn được giữ. Thứ nằm ở
                                   đường dẫn đó mà không do BaoCut đặt thì không bao giờ bị thay hay xoá`,
  help: `baocut update [--check | --rollback]

Cập nhật gói dòng lệnh độc lập: đọc cùng nguồn phát hành với ứng dụng BaoCut, tải gói dòng lệnh của bản phát hành
mới nhất, kiểm tra kích thước và sha256 (trên macOS còn kiểm tra chữ ký và công chứng), cài nó bên cạnh phiên bản hiện
tại và trỏ baocut tới nó. Phiên bản trước được giữ lại cho --rollback; các phiên bản cũ hơn mà không Runtime nào còn
dùng sẽ bị xoá.
  --check      Chỉ cho biết có phiên bản mới hơn hay không
  --rollback   Quay lại phiên bản trước
Runtime đang chạy sẽ giữ phiên bản cũ cho tới khi dừng (baocut runtime stop).
Chỉ gói độc lập được cập nhật theo cách này: ứng dụng BaoCut tự cập nhật, bản cài bằng Homebrew dùng brew upgrade.
Đặt BAOCUT_UPDATE_APPCAST để đọc nguồn khác (URL hoặc tệp cục bộ, để thử nghiệm).`,
  version: (version, build) => `${version} (bản dựng ${build})`,
  state: {
    none: 'Chưa cài',
    current: 'Trỏ tới phiên bản hiện tại',
    stale: 'Trỏ tới một BaoCut khác',
    broken: 'Trỏ tới vị trí không còn tồn tại',
    foreign: 'Có thứ khác ở đó (không đụng tới)',
  },
  statusPackage: (version, root) => `Gói       ${version}  ${root}`,
  statusVersions: (versions, root) => `Đã cài    ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `Chưa cài gì trong ${root}: baocut cli install sẽ sao chép gói này vào đó`,
  currentMark: ' (hiện tại)',
  previousMark: ' (trước đó)',
  copied: (dest, from) => `Đã sao chép gói tới ${dest}; không cần ${from} nữa`,
  versionsKept: (dir) => `Các phiên bản đã cài vẫn ở ${dir}: xoá thư mục đó để gỡ chúng`,
  entryTaken: (path) =>
    `${path} không phải do BaoCut đặt nên được để nguyên. Hãy tự di chuyển hoặc xoá nó, rồi chạy lại baocut cli install`,
  pathFailed: (dir) => `Không thêm được ${dir} vào PATH của người dùng: hãy thêm trong Thuộc tính hệ thống → Biến môi trường`,
  copyFailed: (from, dest, detail) => `Không sao chép được ${from} tới ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update nhận --check hoặc --rollback (chỉ một trong hai): ${token}`,
  updateUnavailable:
    'baocut update cập nhật gói dòng lệnh độc lập. baocut này thuộc ứng dụng BaoCut, vốn tự cập nhật (BaoCut → Kiểm tra cập nhật), hoặc thuộc Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Đã là bản mới nhất: ${current}`,
  available: (latest, current) => `Có ${latest} (bạn đang dùng ${current})`,
  downloading: (version, build, megabytes) => `Đang tải ${version} (bản dựng ${build}), ${megabytes} MB…`,
  updated: (from, to) => `Đã cập nhật ${from} → ${to}`,
  rolledBack: (from, to) => `Đã quay lại từ ${from} về ${to}`,
  rollbackHint: 'Để quay lại: baocut update --rollback',
  entrySwitched: (path) => `${path} giờ trỏ tới phiên bản này`,
  entryNotInstalled: (path) => `${path} chưa được cài: baocut cli install đặt baocut vào PATH`,
  entryLeftAlone: (path) =>
    `${path} trỏ tới thứ khác ngoài gói này nên được để nguyên: baocut cli install sẽ trỏ nó về đây`,
  removedVersions: (versions) => `Đã xoá các phiên bản cũ hơn: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Một Runtime (pid ${pid}) vẫn đang chạy phiên bản lúc nó khởi động; khi nó dừng, lệnh tiếp theo sẽ khởi động phiên bản mới (baocut runtime stop dừng nó ngay)`,
  systemTooOld: (required, system) => `Phiên bản mới cần macOS ${required}; máy Mac này có ${system}`,
  feedFailed: (url, detail) => `Không đọc được nguồn phát hành ${url}: ${detail}`,
  feedMissing: (url) => `Nguồn phát hành ${url} chưa có gói dòng lệnh: hãy thử lại sau bản phát hành tiếp theo`,
  downloadFailed: (url, detail) => `Không tải được ${url}: ${detail}`,
  verifyFailed: (detail) => `Gói đã tải không qua được các bước kiểm tra và chưa được cài: ${detail}`,
  unsignedBuild:
    'Gói này không được ký nên không thể kiểm tra chữ ký của bản cập nhật. Hãy tải gói độc lập từ trang phát hành của BaoCut',
  noPrevious: (dir) => `Không có phiên bản trước nào để quay lại trong ${dir}`,
  inProgress: (pid) => `Một baocut update khác (pid ${pid}) đang chạy: hãy chờ nó xong`,
};
