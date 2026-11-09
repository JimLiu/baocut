import type { SkillsMessages } from './skills-copy.ts';

export const vi: SkillsMessages = {
skillsHelp: `Cách dùng:
  baocut skills add <folder>       Sao chép thư mục Skill cục bộ (SKILL.md ở gốc) vào
                                   <BAOCUT_HOME>/skills, mặc định bật
  baocut skills import <source>    Nhập Skill từ GitHub: owner/repo, URL kho hoặc
                                   …/tree/<branch>/<folder>; mặc định tắt, xem lại trước khi bật
    --id <id>                      Với add và import: dùng id khác (mặc định từ tên thư mục;
                                   từ chối nếu id tồn tại, không ghi đè)
  baocut skills enable|disable <id>
                                   Bật / tắt Skill: có hiệu lực từ phiên Agent mới tiếp theo
  baocut skills remove <id>        Xóa Skill đã thêm hoặc nhập (không xóa Skill có sẵn, chỉ tắt)`,
added: 'Đã thêm', imported: 'Đã nhập', turnedOn: 'Đã bật', turnedOff: 'Đã tắt', reviewFirst: (id) => `Xem lại trước (baocut skills read ${id}) rồi bật bằng baocut skills enable ${id}`, takesEffectNextSession: 'Có hiệu lực từ phiên Agent mới tiếp theo; không ảnh hưởng phiên đang chạy', removed: (id, path) => `Đã xóa ${id} (${path})`, localSource: (path, addedAt) => `thư mục cục bộ ${path} (${addedAt})`, remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`, changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? 'bật' : 'tắt'}) → ${path}${source ? `\nNguồn: ${source}` : ''}`, idFormat: (flag, value) => `${flag} nhận id Skill (chữ thường, cách bằng gạch nối, xem baocut skills): ${value}`,
skillHelp: `Cách dùng:
  baocut skill install [--dir <thư mục>]… [--agent agents|claude] [--copy]
                                   Cài skill BaoCut cho agent bên ngoài (cách dùng BaoCut). Mặc định vào
                                   ~/.agents/skills/baocut (Codex và các agent khác) và ~/.claude/skills/baocut (Claude Code),
                                   dưới dạng liên kết tới skill trong ứng dụng BaoCut, nên nó cập nhật cùng ứng dụng
    --dir <thư mục>                Cài vào <thư mục>/.agents/skills và <thư mục>/.claude/skills thay vào đó: thư mục bất kỳ,
                                   không chỉ dự án BaoCut; lặp lại cho nhiều thư mục
    --agent agents|claude          Chỉ một trong hai: .agents/skills hoặc .claude/skills
    --copy                         Sao chép thay vì liên kết (bản sao không theo cập nhật của ứng dụng: cài lại để cập nhật)
  baocut skill status              Phiên bản skill trong ứng dụng, nơi đã cài và mỗi nơi có mới nhất không,
                                   cùng lệnh baocut trong terminal của bạn
  baocut skill remove [--dir <thư mục>]… [--agent agents|claude] [--yes]
                                   Gỡ: với liên kết chỉ xoá liên kết; xoá bản sao cần --yes.
                                   Thứ nằm ở baocut/ mà không phải skill BaoCut thì không bao giờ bị thay hay xoá`,
  installedAt: (path, linkTarget) => `Đã cài ${path}${linkTarget ? ` → ${linkTarget}` : ' (bản sao)'}`,
  takesEffect: 'Có hiệu lực trong phiên agent mới',
  removedAt: (path) => `Đã gỡ ${path}`,
  removeCopies: (paths) => `${paths.join(', ')} là bản sao: gỡ sẽ xoá tệp, kể cả những chỉnh sửa đã làm ở đó. Thêm --yes để xoá`,
  unknownAgent: (value) => `--agent nhận agents (.agents/skills) hoặc claude (.claude/skills): ${value}`,
  fixHint: 'Có bản cài đã cũ hoặc hỏng: baocut skill install (với cùng --dir) sẽ sửa',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (bản phát triển: do Runtime tạo)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'không kèm theo (bản phát triển)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (của ứng dụng này)' : ' (không phải của ứng dụng này)'}`,
  statusNotOnPath: (command) => `Terminal  baocut không có trong PATH${command ? `; để dùng ở mọi terminal: ${command}` : ''}`,
  appOutsideApplications: 'BaoCut không chạy từ thư mục Ứng dụng: liên kết sẽ hỏng nếu bạn di chuyển hoặc xoá ứng dụng',
  globalHeading: 'Toàn cục',
  state: { none: 'Chưa cài', current: 'Mới nhất', stale: 'Đã cũ', broken: 'Liên kết hỏng', foreign: 'Có thứ khác ở đó (không đụng tới)' },
  mode: { link: 'Liên kết', copy: 'Bản sao' },

  cliHelp: `Cách dùng:
  baocut cli install               Đặt baocut vào PATH, trỏ tới dòng lệnh trong ứng dụng BaoCut. macOS: liên kết tại
                                   ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, kèm thư mục đó
                                   được thêm vào PATH của người dùng. Không cần quyền quản trị
  baocut cli status                baocut nằm ở đâu, có trỏ tới ứng dụng này không, và terminal của bạn tìm thấy baocut nào
  baocut cli remove                Gỡ những gì baocut cli install đã đặt. Thứ nằm ở đường dẫn đó mà không do BaoCut đặt thì
                                   không bao giờ bị thay hay xoá`,
  cliStatusEntry: (path, target, state) => `Lệnh      ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `Ứng dụng  ${entry ?? 'không kèm dòng lệnh (bản phát triển): hãy cài từ ứng dụng BaoCut'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'không tìm thấy baocut'}`,
  cliStatusUnchecked: 'Terminal  không kiểm tra được PATH của terminal: mở terminal mới và chạy baocut version',
  cliShadowed: (found, dir) => `Terminal  tìm thấy ${found} trước. Để dùng bản này, hãy gỡ bản kia hoặc đặt ${dir} lên trước trong PATH`,
  cliPathHint: (dir, line, file) => `${dir} chưa có trong PATH của terminal. Thêm dòng này vào ${file ?? 'cấu hình shell của bạn'}, rồi mở terminal mới:\n  ${line}`,
  cliInstalled: (path, target) => `Đã cài ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} đã có trong PATH của người dùng: mở terminal mới để dùng baocut`,
  cliRemoved: (path) => `Đã gỡ ${path}`,
  cliNothingToRemove: (path) => `Không có gì để gỡ ở ${path}`,
  cliInstallHint: 'baocut cli install đặt baocut vào PATH',
  cliFixHint: 'baocut cli install sẽ trỏ nó tới ứng dụng này',
  cliState: {
    none: 'Chưa cài',
    current: 'Trỏ tới ứng dụng này',
    stale: 'Trỏ tới một BaoCut khác',
    broken: 'Trỏ tới vị trí không còn tồn tại',
    foreign: 'Có thứ khác ở đó (không đụng tới)',
    standalone: 'Trỏ tới gói dòng lệnh độc lập, gói đó tự quản lý (baocut update; không đụng tới)',
  },
};
