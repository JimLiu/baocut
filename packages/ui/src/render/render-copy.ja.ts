import type { RenderMessages } from './render-copy.ts';

export const ja: RenderMessages = {
  confetti: {
    shapes: {
      rect: '紙片',
      strip: '紙テープ',
      circle: 'ドット',
      ellipse: '楕円',
      triangle: '三角形',
      diamond: 'ひし形',
      star: '星',
      starlet: '四芒星',
      sparkle: 'きらめき',
      heart: 'ハート',
      petal: '花びら',
      ribbon: 'リボン',
    },
    styles: {
      'rainbow-paper': '虹色の紙吹雪',
      'pastel-fall': 'パステルの舞い',
      'neon-streamers': 'ネオンの紙テープ',
      'golden-starburst': '金色のスターバースト',
      'festival-fireworks': 'お祭りの花火',
      'hearts-petals': 'ハートと花びら',
      'party-cannons': 'パーティークラッカー',
      'curling-ribbons': 'カールリボン',
      'geometric-pop': '幾何学ポップ',
      'champagne-sparkle': 'シャンパンのきらめき',
    },
  },
  fonts: {
    tableFailed: (status) => `フォントテーブルを取得できませんでした：${status}`,
    tableLength: (expected, got) => `フォントテーブルの長さが正しくありません：想定 ${expected} バイト、実際 ${got}`,
    localMissing: (family) => `ローカルフォント ${family} が見つかりません`,
    notFound: (name) => `フォント ${name} が見つかりません。先に npm run build:wasm を実行してください`,
    unreadable: (name, status) => `フォント ${name} を読み込めませんでした（${status}）`,
    unreadableUrl: (url) => `フォントを読み込めませんでした：${url}`,
  },
  planner: {
    wasmMissing: 'プレビューの WASM を利用できません。先に npm run build:wasm を実行してください',
    reloading: 'フレームプランナを再読み込み中',
    crashed: (message) => `フレームプランナでエラーが発生したため、再読み込みしています：${message}`,
    reloadFailed: 'フレームプランナを再読み込みできませんでした',
  },
};
