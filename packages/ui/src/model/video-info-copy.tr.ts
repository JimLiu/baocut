import type { VideoInfoMessages } from './video-info-copy.ts';

export const tr: VideoInfoMessages = {
  section: { media: 'Kaynak ve medya', source: 'Kaynak bilgisi' },
  speakers: (count: number) => `${count} konuşmacı`,
  chapters: (count: number) => `${count} bölüm`,
  paragraphs: (count: number) => `${count} paragraf`,
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: {
    'link-import': 'URL’den içe aktarıldı',
    'user-import': 'Yerel dosya',
    generated: 'Oluşturuldu',
    library: 'Kullanıcı kitaplığı',
  },
  row: {
    contents: 'İçerik',
    translation: 'Çeviri',
    location: 'Konum',
    file: 'Dosya',
    media: 'Medya',
    transcript: 'Yazıya dökme',
    channel: 'Kanal',
    published: 'Yayımlanma',
    platform: 'Platform',
    mediaId: 'Video ID',
    url: 'URL',
    title: 'Orijinal başlık',
    description: 'Açıklama',
  },
};
