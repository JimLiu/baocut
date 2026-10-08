import type { TranslateSetupMessages } from './translate-setup.ts';

export const vi: TranslateSetupMessages = {
  sameAsSource: 'Cùng ngôn ngữ với bản gốc',
  alreadyTranslated: 'Đã có bản dịch bằng ngôn ngữ này',
  glossaryGone: 'Không còn trong thư viện bảng thuật ngữ · không dùng lần này',
  reading: 'Đang đọc…',
  unreadable: 'Không đọc được · không dùng lần này',
  anyLanguage: 'Ngôn ngữ bất kỳ',
  wrongDirection: (source: string, target: string) => `Hướng là ${source} → ${target} · không dùng lần này`,
};
