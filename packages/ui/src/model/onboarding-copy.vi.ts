import type { OnboardingMessages } from './onboarding-copy.ts';

export const vi: OnboardingMessages = {
  dialogLabel: 'Chào mừng bạn đến với BaoCut',
  stepsLabel: 'Các bước thiết lập',
  step: {
    agent: 'Kết nối Agent',
    asr: 'Nhận dạng giọng nói',
    tts: 'Tổng hợp giọng nói',
    semantic: 'Tìm kiếm ngữ nghĩa',
    image: 'Tạo hình ảnh',
    music: 'Tạo nhạc',
  },
  title: {
    agent: 'Chào mừng bạn đến với BaoCut',
    asr: 'Tải xuống mô hình nhận dạng giọng nói',
    tts: 'Tải xuống mô hình tổng hợp giọng nói',
    semantic: 'Cài tìm kiếm ngữ nghĩa',
    image: 'Tải xuống mô hình tạo hình ảnh',
    music: 'Tải xuống mô hình tạo nhạc',
  },
  lead: {
    agent:
      'Mô tả video bạn muốn, Agent sẽ chép lời, thêm phụ đề, dịch, lồng tiếng và biên tập giúp bạn. BaoCut dùng các Agent trên máy tính này (như Claude Code hoặc Codex) bằng tài khoản của chính bạn, không tính thêm phí.',
    asr: 'Chép lời, thêm phụ đề và cắt tỉa video người nói đều bắt đầu từ việc chuyển lời nói thành văn bản. Mô hình chạy trên máy tính này và dùng được cả khi không có mạng.',
    tts: 'Mô hình tổng hợp giọng nói đọc to văn bản, nhân bản giọng từ một bản ghi âm và lồng tiếng cho video đã dịch. Hãy chọn một hai mô hình để bắt đầu; các mô hình khác có thể tải sau trong Cài đặt › Tổng hợp giọng nói.',
    semantic:
      'Tìm lời đã nói và hình ảnh đã xuất hiện theo ý nghĩa: tìm kiếm Space, chọn tư liệu theo chủ đề, ghép hình ảnh và bộ nhớ dịch đều dùng đến nó. Sau khi cài, các video sẵn có sẽ được lập chỉ mục trong nền.',
    image: 'Tạo hình ảnh từ một câu ngay trên máy tính này, dùng làm ảnh bìa và minh họa. Mô hình rất lớn và tạo ảnh khá chậm.',
    music:
      'Tạo nhạc nền và bài hát từ một phong cách hoặc lời bài hát ngay trên máy tính này, sẵn sàng thêm vào rãnh nhạc của video. Tạo nhạc khá chậm: khoảng vài phút cho 30 giây.',
  },
  where: {
    tts: {
      title: 'Dùng trong Công cụ › Tạo giọng nói',
      body: 'Viết một đoạn văn bản, hoặc chọn tài liệu hay phụ đề trong Space, rồi chọn mô hình và giọng. Mô hình chưa tải cũng có thể tải xuống ở đó.',
    },
    image: { title: 'Dùng trong Công cụ › Tạo hình ảnh', body: 'Mô tả bức ảnh bằng một câu. Agent cũng dùng nó để làm ảnh bìa.' },
    music: {
      title: 'Dùng trong Công cụ › Tạo nhạc',
      body: 'Chọn phong cách và viết lời. Nhạc được lưu vào Space và có thể thêm vào video của bạn.',
    },
  },
  diarizes: 'Phân biệt người nói khi chép lời',
  needsDiarization: (pack) => `Để phân biệt người nói, hãy tải thêm “${pack}”`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 giọng có sẵn · mô tả phong cách nói bằng một câu',
    'qwen3-tts-0.6b-base': 'Nhân bản giọng từ bản ghi âm 3 giây',
    voxcpm2: 'Nhân bản giọng từ bản ghi âm · mô tả phong cách · 30 ngôn ngữ và tiếng Quảng Đông',
    'qwen-image-2.1-turbo': 'Bản chưng cất · cố định 8 bước · nhanh hơn bản gốc hơn 2 lần',
    'qwen-image-2.1': 'Mô hình gốc · chậm hơn, nhiều bước hơn',
    'yue2-3b': 'Tạo từ phong cách hoặc lời bài hát · khoảng vài phút cho 30 giây',
  },
  recommended: 'Được đề xuất',
  installed: 'Đã cài',
  missingParts: 'Thiếu thành phần',
  planLine: (parts) => `Tải cùng lúc: ${parts}`,
  downloading: (name) => `Đang tải ${name}`,
  inBackground: 'Đang tải trong nền',
  bgNote: 'Trước khi tải, bạn sẽ thấy nguồn tải và nơi lưu. Việc tải chỉ bắt đầu sau khi bạn xác nhận và chạy trong nền, nên không cần chờ.',
  asrAlt: 'Không muốn tải xuống? Bạn cũng có thể thêm nhận dạng giọng nói trên đám mây sau trong Cài đặt › Nhà cung cấp API.',
  unsupported: 'Máy tính này không chạy được các mô hình này. Bạn có thể bỏ qua bước này.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agent trên máy tính này',
  agentChecking: 'Đang kiểm tra Agent trên máy tính này…',
  agentMissingBody: 'Đánh dấu các Agent bạn muốn, BaoCut sẽ cài chúng trong nền. Sau khi cài, đăng nhập một lần bằng tài khoản sẵn có của bạn.',
  agentNote:
    'Các Agent đã đánh dấu sẽ xuất hiện trong menu Agent của phiên mới. Việc cài chạy trong nền, nên không cần chờ. Chọn Agent mặc định hoặc thêm Agent khác trong Cài đặt › Nhà cung cấp Agent.',
  agentInstalled: 'Đã cài trên máy tính này',
  agentFix: (problem) => `${problem} · Khắc phục trong Cài đặt › Nhà cung cấp Agent`,
  agentManual: 'Cài trong terminal theo hướng dẫn chính thức · Xem Cài đặt › Nhà cung cấp Agent',
  agentNotInstalled: (plan) => (plan ? `Chưa cài · Sau khi cài, đăng nhập bằng: ${plan}` : 'Chưa cài'),
  agentWillInstall: (method, command, login) => `Sẽ cài trong nền bằng ${method} (${command}) · Sau đó chạy ${login} trong terminal để đăng nhập`,
  agentInstalling: (method, login) => `Đang cài trong nền bằng ${method} · Sau đó chạy ${login} trong terminal để đăng nhập`,
  agentInstallingLabel: (name) => `Đang cài ${name}`,
  agentInstallFailed: 'Không cài được · Chi tiết trong Tác vụ nền',

  next: 'Tiếp',
  finish: 'Xong',
  skip: 'Bỏ qua',
  exit: 'Thoát thiết lập',
  install: (n) => `Cài ${n} Agent trong nền và tiếp tục`,
  download: (size, last) => `Tải xuống${size ? ` ${size}` : ''} trong nền và ${last ? 'hoàn tất' : 'tiếp tục'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Đang cài ${name}${tail}` : kind === 'download' ? `Đang tải ${name}${tail}` : `Đang thiết lập ${name}${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `Đang cài ${n} mục trong nền` : kind === 'download' ? `Đang tải ${n} mục trong nền` : `Đang thiết lập ${n} mục trong nền`,
    idle: (kind) => (kind === 'install' ? 'Cài trong nền' : kind === 'download' ? 'Tải trong nền' : 'Tải và cài trong nền'),
    done: (kind, n) => (kind === 'install' ? `Đã cài ${n}` : kind === 'download' ? `Đã tải ${n}` : `Đã xong ${n}`),
    failed: (kind, n) => (kind === 'install' ? `${n} chưa cài được` : kind === 'download' ? `${n} chưa tải được` : `${n} chưa xong`),
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`tải ${models} mô hình`] : []), ...(agents ? [`cài ${agents} Agent`] : [])];
    return `Đang ${parts.join(' và ')} trong nền. Xong là dùng được ngay.`;
  },
  viewTasks: 'Xem tác vụ nền',
};
