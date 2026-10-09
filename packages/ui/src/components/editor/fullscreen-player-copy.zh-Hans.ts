import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const zhHans: FullscreenPlayerMessages = {
  region: '全屏播放器',
  enter: '全屏播放',
  enterTip: '全屏播放（F）',
  captions: '字幕',
  captionsTip: (mode: string) => `字幕：${mode}（C）`,
  captionMode: { off: '关闭字幕', source: '原文', trans: '译文', both: '双语' },
  keysTip: '键盘快捷键（?）',
  keysTitle: '键盘快捷键',
  keysFooter: '按 Esc 关掉这张表，再按一次退出全屏。',
  keys: {
    play: '播放 / 暂停（画面上单击同义）',
    exit: '退出全屏（画面上双击同义）',
    back: '后退 / 前进 5 秒',
    back10: '后退 / 前进 10 秒',
    prevChapter: '上一章 / 下一章',
    volUp: '音量 ±10（自动取消静音）',
    mute: '静音 / 取消静音',
    captions: '字幕档位轮转',
    start: '跳到片头 / 片尾',
    percent: '跳到成片的 0% – 90%',
    keys: '这张表',
  },
};
