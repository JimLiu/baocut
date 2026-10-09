import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const vi: FullscreenPlayerMessages = {
  region: 'Trình phát toàn màn hình',
  enter: 'Phát toàn màn hình',
  enterTip: 'Phát toàn màn hình (F)',
  captions: 'Phụ đề',
  captionsTip: (mode: string) => `Phụ đề: ${mode} (C)`,
  captionMode: { off: 'Tắt phụ đề', source: 'Bản gốc', trans: 'Bản dịch', both: 'Song ngữ' },
  keysTip: 'Phím tắt (?)',
  keysTitle: 'Phím tắt',
  keysFooter: 'Nhấn Esc để đóng bảng này, nhấn lần nữa để thoát toàn màn hình.',
  keys: {
    play: 'Phát / tạm dừng (giống nhấp một lần lên hình)',
    exit: 'Thoát toàn màn hình (giống nhấp đúp lên hình)',
    back: 'Lùi / tiến 5 giây',
    back10: 'Lùi / tiến 10 giây',
    prevChapter: 'Chương trước / sau',
    volUp: 'Âm lượng ±10 (tự bỏ tắt tiếng)',
    mute: 'Tắt / bật tiếng',
    captions: 'Chuyển chế độ phụ đề',
    start: 'Nhảy tới đầu / cuối',
    percent: 'Nhảy tới 0% – 90% video',
    keys: 'Bảng này',
  },
};
