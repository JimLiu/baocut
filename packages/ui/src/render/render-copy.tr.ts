import type { RenderMessages } from './render-copy.ts';

export const tr: RenderMessages = {
  confetti: {
    shapes: {
      rect: 'Kâğıt',
      strip: 'Şerit',
      circle: 'Nokta',
      ellipse: 'Elips',
      triangle: 'Üçgen',
      diamond: 'Baklava',
      star: 'Yıldız',
      starlet: 'Dört köşeli yıldız',
      sparkle: 'Parıltı',
      heart: 'Kalp',
      petal: 'Taç yaprak',
      ribbon: 'Kurdele',
    },
    styles: {
      'rainbow-paper': 'Gökkuşağı kâğıdı',
      'pastel-fall': 'Pastel yağışı',
      'neon-streamers': 'Neon şeritler',
      'golden-starburst': 'Altın yıldız patlaması',
      'festival-fireworks': 'Festival havai fişekleri',
      'hearts-petals': 'Kalpler ve taç yapraklar',
      'party-cannons': 'Parti topları',
      'curling-ribbons': 'Kıvrık kurdeleler',
      'geometric-pop': 'Geometrik patlama',
      'champagne-sparkle': 'Şampanya parıltısı',
    },
  },
  fonts: {
    tableFailed: (status) => `Yazı tipi tablosu alınamadı: ${status}`,
    tableLength: (expected, got) => `Yazı tipi tablosunun uzunluğu yanlış: ${expected} bayt bekleniyordu, ${got} alındı`,
    localMissing: (family) => `${family} adlı yerel yazı tipi artık yok`,
    notFound: (name) => `${name} adlı yazı tipi bulunamadı. Önce npm run build:wasm çalıştırın`,
    unreadable: (name, status) => `${name} adlı yazı tipi okunamadı (${status})`,
    unreadableUrl: (url) => `Yazı tipi okunamadı: ${url}`,
  },
  planner: {
    wasmMissing: 'Önizleme WASM kullanılamıyor. Önce npm run build:wasm çalıştırın',
    reloading: 'Kare planlayıcı yeniden yükleniyor',
    crashed: (message) => `Kare planlayıcı hata verdi ve yeniden yükleniyor: ${message}`,
    reloadFailed: 'Kare planlayıcı yeniden yüklenemedi',
  },
};
