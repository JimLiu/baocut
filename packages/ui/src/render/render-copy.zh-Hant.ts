import type { RenderMessages } from './render-copy.ts';

export const zhHant: RenderMessages = {
  confetti: {
    shapes: {
      rect: '紙片',
      strip: '紙條',
      circle: '圓點',
      ellipse: '橢圓',
      triangle: '三角形',
      diamond: '菱形',
      star: '星形',
      starlet: '四角星',
      sparkle: '閃光',
      heart: '愛心',
      petal: '花瓣',
      ribbon: '彩帶',
    },
    styles: {
      'rainbow-paper': '彩虹紙片',
      'pastel-fall': '粉彩飄落',
      'neon-streamers': '霓虹彩帶',
      'golden-starburst': '金色星芒',
      'festival-fireworks': '節慶煙火',
      'hearts-petals': '愛心與花瓣',
      'party-cannons': '派對禮炮',
      'curling-ribbons': '捲曲彩帶',
      'geometric-pop': '幾何迸發',
      'champagne-sparkle': '香檳閃耀',
    },
  },
  fonts: {
    tableFailed: (status) => `無法取得字型表：${status}`,
    tableLength: (expected, got) => `字型表長度不正確：預期 ${expected} 位元組，實際為 ${got}`,
    localMissing: (family) => `本機字型 ${family} 已不存在`,
    notFound: (name) => `找不到字型 ${name}。請先執行 npm run build:wasm`,
    unreadable: (name, status) => `無法讀取字型 ${name}（${status}）`,
    unreadableUrl: (url) => `無法讀取字型：${url}`,
  },
  planner: {
    wasmMissing: '預覽用的 WASM 無法使用。請先執行 npm run build:wasm',
    reloading: '影格規劃器正在重新載入',
    crashed: (message) => `影格規劃器發生錯誤，正在重新載入：${message}`,
    reloadFailed: '影格規劃器無法重新載入',
  },
};
