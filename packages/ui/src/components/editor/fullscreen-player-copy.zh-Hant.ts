import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const zhHant: FullscreenPlayerMessages = {
  region: '全螢幕播放器',
  enter: '全螢幕播放',
  enterTip: '全螢幕播放（F）',
  captions: '字幕',
  captionsTip: (mode: string) => `字幕：${mode}（C）`,
  captionMode: { off: '關閉字幕', source: '原文', trans: '譯文', both: '雙語' },
  keysTip: '鍵盤快速鍵（?）',
  keysTitle: '鍵盤快速鍵',
  keysFooter: '按 Esc 關掉這張表，再按一次結束全螢幕。',
  keys: {
    play: '播放 / 暫停（畫面上單擊同義）',
    exit: '結束全螢幕（畫面上雙擊同義）',
    back: '後退 / 前進 5 秒',
    back10: '後退 / 前進 10 秒',
    prevChapter: '上一章 / 下一章',
    volUp: '音量 ±10（自動取消靜音）',
    mute: '靜音 / 取消靜音',
    captions: '字幕檔位輪轉',
    start: '跳到片頭 / 片尾',
    percent: '跳到成片的 0% – 90%',
    keys: '這張表',
  },
};
