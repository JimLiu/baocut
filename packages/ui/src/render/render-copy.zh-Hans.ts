import type { RenderMessages } from './render-copy.ts';

export const zhHans: RenderMessages = {
  confetti: {
    shapes: {
      rect: '纸片',
      strip: '纸条',
      circle: '圆点',
      ellipse: '椭圆',
      triangle: '三角',
      diamond: '菱形',
      star: '五角星',
      starlet: '四角星',
      sparkle: '闪光',
      heart: '爱心',
      petal: '花瓣',
      ribbon: '彩带',
    },
    styles: {
      'rainbow-paper': '缤纷纸片雨',
      'pastel-fall': '马卡龙飘落',
      'neon-streamers': '霓虹彩带',
      'golden-starburst': '金色星芒',
      'festival-fireworks': '缤纷礼花',
      'hearts-petals': '爱心花瓣',
      'party-cannons': '双侧礼炮',
      'curling-ribbons': '卷曲彩带',
      'geometric-pop': '几何喷射',
      'champagne-sparkle': '香槟闪耀',
    },
  },
  fonts: {
    tableFailed: (status) => `字体的表取不到：${status}`,
    tableLength: (expected, got) => `字体的表长度不对：要 ${expected} 字节，拿到 ${got}`,
    localMissing: (family) => `本机字体 ${family} 不见了`,
    notFound: (name) => `没有找到字体 ${name}：先运行 npm run build:wasm`,
    unreadable: (name, status) => `字体 ${name} 读不到（${status}）`,
    unreadableUrl: (url) => `字体读不到：${url}`,
  },
  planner: {
    wasmMissing: '预览的 WASM 不可用，先运行 npm run build:wasm',
    reloading: '帧计划器正在重新载入',
    crashed: (message) => `帧计划器出错，正在重新载入：${message}`,
    reloadFailed: '帧计划器重新载入失败',
  },
};
