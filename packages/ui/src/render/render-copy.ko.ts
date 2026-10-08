import type { RenderMessages } from './render-copy.ts';

export const ko: RenderMessages = {
  confetti: {
    shapes: {
      rect: '종이',
      strip: '띠',
      circle: '점',
      ellipse: '타원',
      triangle: '삼각형',
      diamond: '마름모',
      star: '별',
      starlet: '네 꼭짓점 별',
      sparkle: '반짝임',
      heart: '하트',
      petal: '꽃잎',
      ribbon: '리본',
    },
    styles: {
      'rainbow-paper': '무지개 종이',
      'pastel-fall': '파스텔 낙하',
      'neon-streamers': '네온 스트리머',
      'golden-starburst': '황금 별빛',
      'festival-fireworks': '축제 불꽃놀이',
      'hearts-petals': '하트와 꽃잎',
      'party-cannons': '파티 폭죽',
      'curling-ribbons': '곱슬 리본',
      'geometric-pop': '기하학 팝',
      'champagne-sparkle': '샴페인 반짝임',
    },
  },
  fonts: {
    tableFailed: (status) => `글꼴 테이블을 가져오지 못했습니다: ${status}`,
    tableLength: (expected, got) => `글꼴 테이블 길이가 잘못되었습니다: 예상 ${expected}바이트, 실제 ${got}`,
    localMissing: (family) => `로컬 글꼴이 사라졌습니다: ${family}`,
    notFound: (name) => `글꼴을 찾을 수 없습니다: ${name}. 먼저 npm run build:wasm 명령을 실행하세요`,
    unreadable: (name, status) => `글꼴을 읽지 못했습니다: ${name}(${status})`,
    unreadableUrl: (url) => `글꼴을 읽지 못했습니다: ${url}`,
  },
  planner: {
    wasmMissing: '미리보기 WASM을 사용할 수 없습니다. 먼저 npm run build:wasm 명령을 실행하세요',
    reloading: '프레임 플래너를 다시 불러오는 중입니다',
    crashed: (message) => `프레임 플래너에 오류가 발생해 다시 불러오는 중입니다: ${message}`,
    reloadFailed: '프레임 플래너를 다시 불러오지 못했습니다',
  },
};
