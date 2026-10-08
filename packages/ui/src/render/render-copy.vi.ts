import type { RenderMessages } from './render-copy.ts';

export const vi: RenderMessages = {
  confetti: {
    shapes: {
      rect: 'Giấy',
      strip: 'Dải',
      circle: 'Chấm',
      ellipse: 'Elip',
      triangle: 'Tam giác',
      diamond: 'Hình thoi',
      star: 'Ngôi sao',
      starlet: 'Sao bốn cánh',
      sparkle: 'Lấp lánh',
      heart: 'Trái tim',
      petal: 'Cánh hoa',
      ribbon: 'Ruy băng',
    },
    styles: {
      'rainbow-paper': 'Giấy cầu vồng',
      'pastel-fall': 'Mưa màu pastel',
      'neon-streamers': 'Dải neon',
      'golden-starburst': 'Tia sao vàng',
      'festival-fireworks': 'Pháo hoa lễ hội',
      'hearts-petals': 'Trái tim và cánh hoa',
      'party-cannons': 'Pháo tiệc',
      'curling-ribbons': 'Ruy băng cuộn',
      'geometric-pop': 'Bùng nổ hình học',
      'champagne-sparkle': 'Lấp lánh sâm panh',
    },
  },
  fonts: {
    tableFailed: (status) => `Không lấy được bảng phông chữ: ${status}`,
    tableLength: (expected, got) => `Độ dài bảng phông chữ sai: cần ${expected} byte, nhận được ${got}`,
    localMissing: (family) => `Phông chữ cục bộ ${family} đã mất`,
    notFound: (name) => `Không tìm thấy phông chữ ${name}. Chạy npm run build:wasm trước`,
    unreadable: (name, status) => `Không đọc được phông chữ ${name} (${status})`,
    unreadableUrl: (url) => `Không đọc được phông chữ: ${url}`,
  },
  planner: {
    wasmMissing: 'WASM xem trước không khả dụng. Chạy npm run build:wasm trước',
    reloading: 'Bộ lập kế hoạch khung hình đang tải lại',
    crashed: (message) => `Bộ lập kế hoạch khung hình gặp lỗi và đang tải lại: ${message}`,
    reloadFailed: 'Không tải lại được bộ lập kế hoạch khung hình',
  },
};
