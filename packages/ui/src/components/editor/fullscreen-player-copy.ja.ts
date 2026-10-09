import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const ja: FullscreenPlayerMessages = {
  region: 'フルスクリーンプレーヤー',
  enter: 'フルスクリーン再生',
  enterTip: 'フルスクリーン再生（F）',
  captions: '字幕',
  captionsTip: (mode: string) => `字幕：${mode}（C）`,
  captionMode: { off: '字幕オフ', source: '原文', trans: '翻訳', both: 'バイリンガル' },
  keysTip: 'キーボードショートカット（?）',
  keysTitle: 'キーボードショートカット',
  keysFooter: 'Esc でこの一覧を閉じ、もう一度押すとフルスクリーンを終了します。',
  keys: {
    play: '再生 / 一時停止（映像上のシングルクリックと同じ）',
    exit: 'フルスクリーンを終了（映像上のダブルクリックと同じ）',
    back: '5 秒戻る / 進む',
    back10: '10 秒戻る / 進む',
    prevChapter: '前 / 次のチャプター',
    volUp: '音量 ±10（自動でミュート解除）',
    mute: 'ミュート / ミュート解除',
    captions: '字幕モードを切り替え',
    start: '先頭 / 末尾へ移動',
    percent: '動画の 0% – 90% へ移動',
    keys: 'この一覧',
  },
};
