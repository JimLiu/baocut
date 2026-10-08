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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Cài Skill BaoCut cho Agent bên ngoài (cách dùng BaoCut) vào baocut/
                                   trong thư mục Skill của ứng dụng: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Dùng thư mục Skill khác (cài vào baocut/ bên dưới); bắt buộc nếu không có --agent
    --link                         Đặt Skill đã tạo trong <BAOCUT_HOME>/agent-skills/baocut và liên kết vào ứng dụng:
                                   cài lại sau (cho bất kỳ ứng dụng nào) sẽ cập nhật tất cả
    --yes                          Thay đích nếu đã tồn tại (với liên kết chỉ thay liên kết, không thay
                                   thư mục được trỏ đến); không có thì không ghi đè
  baocut skill path                Nguồn Skill BaoCut, vị trí mỗi ứng dụng cài và nội dung
                                   hiện đã cài (không cần Runtime)`,
targetExists: (target, linkTarget) => `${target} đã tồn tại (${linkTarget !== null ? `liên kết đến ${linkTarget}` : 'thư mục hoặc tệp'}); chưa đổi gì. Thêm --yes để thay thế`, installed: (target, files, linkTo) => `Đã cài Skill BaoCut vào ${target} (${files} tệp${linkTo ? `, liên kết đến ${linkTo}` : ''})`, takesEffect: (host) => host ? `Có hiệu lực trong phiên ${host} mới` : 'Có hiệu lực trong phiên mới', pathEscapes: (path) => `Đường dẫn trong Skill BaoCut trỏ ra ngoài thư mục: ${path}`, sourceLine: (dir) => `Nguồn    ${dir ?? 'không tìm thấy (BaoCut chưa cài và đây không phải kho; bạn có thể đặt BAOCUT_AGENT_SKILLS_DIR)'}`, notInstalled: 'Chưa cài', linkState: (target) => `Liên kết → ${target}`, installedFolder: 'Đã cài (thư mục)', isFile: 'Tệp (không phải thư mục Skill)',
};
