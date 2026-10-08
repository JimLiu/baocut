import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';


function secondsLabel(seconds: number): string { return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1).replace('.', ',')} giây` : `${Math.round(seconds)} giây`; }

export const viSeconds = secondsLabel;

export const viTranscript: TranscriptMessages = {
  title: "Bản chép lời",
  modes: "Chế độ sửa bản chép lời",
  modeEdit: "Chỉnh sửa văn bản",
  modeCut: "Cắt tư liệu",

  hintEdit: "Chỉ đổi văn bản chép lời; giữ video và âm thanh. Nhấp đúp từ để sửa; ⌫ chỉ xóa chữ.",
  hintCut: "Chọn chữ và nhấn ⌫ để cắt cả video, âm thanh và phụ đề. Từ cắt giữ gạch ngang, có thể khôi phục.",

  emptyTitle: "Chưa có bản chép lời",
  emptyNoMedia: "Thêm video hoặc âm thanh trước. Chép lời xong, lời nói hiện tại đây.",
  emptyNotPlaced: "Video hoặc âm thanh chưa trên dòng thời gian. Đặt lên và chép lời để hiện bản chép tại đây.",
  emptyNotTranscribed: "Tư liệu trên dòng thời gian chưa chép lời. Chép trong bảng Phụ đề để hiện tại đây.",
  gotoSubtitle: "Chép lời trong Phụ đề",
  addMedia: "Thêm nội dung",
  loading: "Đang tải bản chép lời…",
  noWords: "Bản chép lời không có từ để hiện.",
  notSpeech: "Định dạng bản chép lời không nhận dạng được.",


  stats: (count, cut) => cut ? `${count} từ · ${cut} đã cắt` : `${count} từ`,
  jump: "Đến đây",
  cutWordTitle: "Cắt khỏi dòng thời gian",
  partialWordTitle: "Đoạn cắt nằm trong từ; chỉ phần còn lại trên dòng thời gian",

  // 选区条
  selected: (count, seconds) => seconds === null ? `Đã chọn ${count} từ` : `Đã chọn ${count} từ · ${secondsLabel(seconds)}`,
  cut: "Cắt",
  restore: "Khôi phục",
  editWord: "Sửa từ",
  deleteText: "Xóa văn bản",
  clear: "Bỏ chọn · Esc",
  aiFind: "Tìm chỗ cắt",
  aiFindHint: "Hoặc để AI tìm từ đệm và khoảng ngắt trước",

  // 结果
  cutDone: (seconds, ranges) => ranges > 1 ? `Đã cắt ${secondsLabel(seconds)} · ${ranges} phạm vi` : `Đã cắt ${secondsLabel(seconds)}`,
  cutNothing: "Từ chọn không còn trên dòng thời gian; không có gì cắt.",
  cutTooShort: "Vùng chọn ngắn hơn một khung hình, không cắt được.",
  restoreDone: (seconds) => `Đã khôi phục ${secondsLabel(seconds)}`,
  restoreNotRelaid: "Một số đoạn cắt không có mối nối tương ứng. Đã bỏ khỏi danh sách cắt nhưng chưa đặt lại nội dung.",
  restoreRefused: {
    untracked: "Phạm vi này không bỏ bằng cắt (ví dụ kéo cạnh clip để cắt tỉa) nên không có đoạn cắt để khôi phục. Kéo cạnh clip trên dòng thời gian để đưa lại.",
    partial: "Chỉ một phần phạm vi bỏ bằng cắt nên không đổi phạm vi được. Nhấp dải cắt để khôi phục phần đó trước.",
  },
  textSaved: "Đã cập nhật chữ · giữ video và âm thanh",
  textDeleted: (count) => `Đã xóa chữ của ${count} từ · giữ video và âm thanh`,

  stale: (count) => `${count} rãnh phụ đề tạo từ bản chép lời cũ chưa cập nhật.`,
  gotoCaptions: "Mở Phụ đề",
  undo: "Hoàn tác",

  // 时间线剪口
  seamLabel: (seconds) => `Đã cắt ${secondsLabel(seconds)} · nhấp khôi phục`,
  cutLabel: "Cắt trong bản chép lời",
  restoreLabel: "Khôi phục nội dung cắt",
  liveCopy: "Sao chép phần đã chép lời",
  liveCopied: "Đã sao chép phần đã chép lời · vẫn đang chuyển âm",
  liveSpeaker: "Đang nhận dạng",
  liveWaiting: "Văn bản nhận dạng được sẽ lần lượt hiện ở đây. Một số dịch vụ chỉ trả về toàn bộ khi xong.",
  liveNote: "Văn bản nhận dạng được hiện theo từng đoạn. Bạn có thể chỉnh sửa khi chuyển âm xong.",
  liveJump: "Về mới nhất",
  liveSaving: "Đang lưu bản chép lời",
};

export const viTranscriptTools: TranscriptToolsMessages = {
  // 工具菜单（原型 panels.jsx 文稿头上的 ✦，产品设计 §5.10）：整理文稿的四件，和从文稿出发的写作、发布
  toolsMenu: "Chỉnh bản chép lời",
  toolsTidy: "Chỉnh toàn bản chép lời",
  toolsFrom: "Bắt đầu từ bản chép lời",
  // 查找替换
  findTip: "Tìm và thay · ⌘F",
  findLabel: "Tìm và thay",
  findPlaceholder: "Tìm trong bản chép lời",

  lockTranslation: "Có thể tìm bản dịch nhưng không sửa tại đây; bảng Bản chép lời chỉ sửa nguồn",
  lockLoading: "Bản chép lời mới đang tải; thay sau khi xong",
  replaceLabel: "Thay văn bản chép lời",
  replaceDone: (count) => `Đã thay ${count} kết quả · giữ video và âm thanh`,
  replaceNothing: "Không có kết quả cần đổi",

  // 复制
  copyMenu: "Sao chép bản chép lời",
  copyAllHead: (lang) => `Sao chép tất cả · ${lang}`,
  copyText: "Sao chép văn bản",
  copySpeaker: "Kèm người nói",
  copyTimed: "Kèm mã thời gian và người nói",
  copyScopeHead: (scope) => `Sao chép ${scope}`,
  copied: (scope, receipt) => `Đã sao chép ${scope} · ${receipt}`,
  copyFailed: "Không sao chép được · trình duyệt từ chối truy cập bảng nhớ",
  copyEmpty: "Không có gì sao chép",
  scopeAll: "tất cả",
  scopePara: "đoạn này",
  scopeChapter: (title: string) => `“${title}”`,
  scopeSelection: "văn bản chọn",
  copySelection: "Sao chép",
  copySelectionTip: "Sao chép chữ chọn · ⌘C",

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: "Ngôn ngữ bản chép lời",
  langSource: "Bản gốc",
  langTranslation: "Bản dịch",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Hiện nguồn bên cạnh",
  showBothNeedsTranslation: "Chọn bản dịch trước",
  showBothHint: "Cạnh nhau",
  noTranslation: "Chưa có bản dịch",
  noTranslationHint: "Dịch từ bảng Phụ đề bằng “+ Dịch sang…”",
  translationNote: "Bản dịch chỉ theo phát từng đoạn; thời gian từ chỉ có trong nguồn nên tô từng từ sẽ không thật.",
  translationOnly: "Không sửa hoặc cắt khi chỉ xem bản dịch; trở lại nguồn hoặc cạnh nhau để sửa.",
  noParagraphTranslation: "Đoạn này không có bản dịch",

  // 段落行（设计稿 `ParaRow`）
  paraMenu: "Đoạn này…",
  moveUp: "Chuyển chương trước",
  moveDown: "Chuyển chương sau",
  play: "Phát đoạn",
  moveHead: "Chuyển đến chương",
  moveTo: (title) => `Chuyển đến “${title}”`,
  moveWith: (count) => count > 1 ? `Chuyển cùng đoạn bên cạnh phía đó, tổng ${count} đoạn` : 'Chỉ chuyển đoạn này',

  noPrev: "Không có chương trước đoạn",
  noNext: "Không có chương sau đoạn",
  moveBlocked: "Chuyển sẽ để chương trống hoặc vượt đầu chương bên cạnh",
  moveLabel: "Chuyển đoạn sang chương bên cạnh",
  moved: (title, count) => count > 1 ? `Đã chuyển ${count} đoạn đến “${title}”` : `Đã chuyển đến “${title}”`,
  cutPara: "Cắt đoạn này",
  cutParaHint: "Cắt cả video, âm thanh và phụ đề; có thể khôi phục",

  // 章节头「这一章…」
  chapterMenu: "Chương này…",
  renameChapter: "Đổi tên…",
  cutChapter: "Cắt chương này",
  cutChapterHint: "Cắt cả video, âm thanh, phụ đề; chương sau chuyển sớm",
  cutChapterLabel: "Cắt chương",
  cutChapterRefused: {
    empty: "Chương không có thời lượng",
    whole: "Chương này là toàn video; cắt sẽ không còn gì",
    'no-tracks': "Không rãnh nào dùng tư liệu chép lời nên không có gì cắt",
  },
  cutChapterDone: (title, seconds) => `Đã cắt “${title}” · ${secondsLabel(seconds)}`,
  removeMarker: "Xóa dấu chương",
  removeMarkerHint: "Chỉ xóa dấu; giữ nội dung",
  find: "Tìm",
  badRegex: "Regex không hợp lệ",
  noResults: "Không có kết quả",
  previous: "Trước",
  next: "Tiếp theo",
  closeFind: "Đóng tìm",
  replaceWith: "Thay thế bằng",
  matchCase: "Phân biệt hoa thường",
  wholeWordShort: "Từ",
  wholeWord: "Khớp cả từ",
  regex: "Biểu thức chính quy · văn bản thay thêm nguyên trạng",
  replace: "Thay",
  replaceAll: "Thay tất cả",
  regexError: (error) => `Lỗi regex: ${error}`,
};
