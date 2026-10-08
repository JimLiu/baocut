import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const vi: TtsQuickTestMessages = {
  kindIntro: 'Giới thiệu',
  kindNumbers: 'Số',
  kindMood: 'Sắc thái',

  presetSub: {
    Vivian: 'Nữ · Tươi sáng',
    Serena: 'Nữ · Điềm tĩnh',
    Uncle_Fu: 'Nam · Trầm',
    Dylan: 'Nam · Trẻ',
    Eric: 'Nam · Phát thanh',
    Ryan: 'Nam · Vui tươi',
    Aiden: 'Nam · Kể chuyện',
    Ono_Anna: 'Nữ · Tiếng Nhật',
    Sohee: 'Nữ · Tiếng Hàn',
  },

  builtinVoice: {
    'zh-female': 'Nữ tiếng Trung',
    'zh-male': 'Nam tiếng Trung',
    'en-female': 'Nữ tiếng Anh',
    'en-male': 'Nam tiếng Anh',
    'ja-female': 'Nữ tiếng Nhật',
    'ja-male': 'Nam tiếng Nhật',
    'es-female': 'Nữ tiếng Tây Ban Nha',
    'es-male': 'Nam tiếng Tây Ban Nha',
  },
  builtinCredit: 'Ngữ liệu FLEURS (CC BY 4.0) và CMU ARCTIC · đã cắt tỉa và chuẩn hóa độ lớn âm thanh · giữ thông báo gốc',

  describeWarm: 'Giọng nữ ấm áp',
  describeWarmText: 'Giọng nữ trưởng thành ấm áp, thân thiện, nhịp vừa phải như trò chuyện với bạn',
  describeAnchor: 'Giọng nam vững vàng',
  describeAnchorText: 'Giọng nam trưởng thành vững vàng, rõ ràng, chất phát thanh và nhịp đều',
  describeBright: 'Giọng trẻ tươi sáng',
  describeBrightText: 'Giọng trẻ tươi sáng, sống động, sắc thái thoải mái',

  toneUpbeat: 'Vui tươi',
  toneUpbeatText: 'Nói với năng lượng tươi sáng, vui tươi, nhanh hơn thường lệ một chút',
  toneNatural: 'Tự nhiên',
  toneAnchor: 'Vững vàng',
  toneAnchorText: 'Nói bằng giọng phát thanh vững vàng, rõ ràng với nhịp đều',
  toneSoft: 'Nhẹ',
  toneSoftText: 'Nói nhẹ và chậm hơn như đang nói chuyện ở gần',

  customDescribe: 'Tự mô tả',
  defaultVoice: 'Giọng mặc định',
  myVoices: 'Giọng của tôi',
  fileVoice: 'Dùng clip một lần',
  seconds: (n: string) => `${n} giây`,

  textRequired: 'Nhập văn bản cần tổng hợp trước',
  textTooLong: (max: number) => `Tối đa ${max} ký tự mỗi lần; dùng câu ngắn hơn để nghe thử`,
  describeRequired: 'Mô tả giọng bạn muốn trong một câu trước',
  myVoiceGone: 'Giọng này không còn trong Giọng của tôi; chọn giọng khác',
  referenceRequired: 'Chọn bản ghi tham chiếu trước hoặc chuyển về giọng có sẵn',

  phaseSubmitting: 'Đang gửi',
  phaseQueued: 'Đang chờ',
  phaseLoading: 'Đang tải mô hình',
  phaseGeneratingStep: (step: number, total: number) => `Đang tạo âm thanh · bước ${step}/${total}`,
  phaseGenerating: 'Đang tạo âm thanh',
  phaseWriting: 'Đang ghi âm thanh',
  phasePreparing: 'Đang chuẩn bị',

  sampleVoice: (name: string) => `Mẫu · ${name}`,
  customText: 'Văn bản tùy chỉnh',
  elapsed: (seconds: string) => `Mất ${seconds} giây`,
  audioLength: (seconds: string) => `Âm thanh ${seconds} giây`,
};
