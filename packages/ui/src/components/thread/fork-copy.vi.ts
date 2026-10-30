import type { ForkMessages } from './fork-copy.ts';

export const vi: ForkMessages = {
  button: 'Tách nhánh từ lượt này',
  fork: 'Tiếp tục trong phiên mới',
  forkHint: 'Mang theo cuộc trò chuyện đến lượt này',
  restore: 'Tiếp tục và khôi phục video về lúc đó…',
  restoreOne: (name) => `“${name}” quay về cuối lượt này`,
  restoreMany: (n) => `${n} video quay về cuối lượt này`,
  restoreNone: 'Các phiên bản lúc đó không còn hoặc không đọc được',
  checking: 'Đang kiểm tra lịch sử phiên bản…',
  dialogTitle: 'Tách nhánh và khôi phục video',
  dialogLead:
    'Phiên mới mang theo cuộc trò chuyện đến lượt này. Các video bên dưới quay về cuối lượt này. Mỗi lần khôi phục được lưu thành một phiên bản mới, nên bạn có thể quay lại từ lịch sử phiên bản.',
  listLabel: 'Video cần khôi phục',
  cancel: 'Hủy',
  confirm: 'Tách nhánh và khôi phục',
  ok: (version, undone) => `Khôi phục phiên bản ${version}. ${undone} phiên bản sau đó (thay đổi của bạn và của phiên khác) sẽ bị hoàn tác`,
  pruned: 'Phiên bản lúc đó không còn (lịch sử phiên bản chỉ giữ các bản gần đây và bản đã lưu)',
  createdAfter: 'Video này được tạo sau lượt này nên giữ nguyên',
  chainBroken: 'Không đọc được lịch sử phiên bản đến lúc đó',
  done: 'Đã tách nhánh sang phiên mới',
  doneRestored: (n) => `Đã tách nhánh sang phiên mới và khôi phục ${n} video về lúc đó. Bạn có thể quay lại từ lịch sử phiên bản`,
  failed: (error) => `Không thể tách nhánh: ${error}`,
  forkedFrom: (title, turn) => `Tách nhánh từ “${title}” · đến lượt ${turn}`,
  sourceDeleted: '(phiên gốc đã bị xóa)',
  history: (turns, omitted) => `Lịch sử mang theo · ${turns} lượt${omitted ? ` (bỏ qua ${omitted} lượt trước đó)` : ''}`,
  hideHistory: 'Ẩn lịch sử',
};
