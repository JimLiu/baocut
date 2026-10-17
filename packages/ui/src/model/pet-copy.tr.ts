import type { PetMessages } from './pet-copy.ts';

export const tr: PetMessages = {
  title: 'Codex Pets',
  note: '8 sütunlu sprite sayfaları · bekleme döngüsü · oynatma kafasını izler',
  peekNote: (count) => `${count} topluluk`,
  categoryChips: 'Evcil hayvan kategorileri',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Oyun karakterleri',
    'anime-characters': 'Anime karakterleri',
    animals: 'Hayvanlar',
    'original-characters': 'Özgün karakterler',
    mascots: 'Maskotlar',
    others: 'Diğer',
    memes: 'Mimler',
    'fantasy-creatures': 'Fantastik yaratıklar',
    'human-avatars': 'İnsan avatarları',
    robots: 'Robotlar',
    'objects-props': 'Nesneler ve aksesuarlar',
  },
  noMatch: 'Eşleşen evcil hayvan yok',
  noMatchHint: 'Başka bir sözcük veya kategori deneyin',
  nonCommercial: 'Yalnızca ticari olmayan kullanım',
  communityNote:
    'Topluluk evcil hayvanları awesome-codex-pet’ten gelir ve her yazarın belirttiği lisansla kullanılır (çoğu CC BY-NC 4.0; turuncu olanlar yalnızca ticari olmayan kullanım içindir). Atıf, öğeyle birlikte kaydedilir. Küçük resimler ve sprite sayfaları gerektiğinde indirilip bu bilgisayarda saklanır.',
  hint: 'Codex Pet, Codex masaüstü evcil hayvan biçimidir: 8 sütunda 192×208 hücreli bir WebP sprite sayfası (v1’de 9 satır, v2’de 11), her satır bir durum. Tuvalde bekleme satırını döngüyle oynatır ve oynatma kafasını izler. Sprite sayfası ilk kullanımda indirilir ve bu bilgisayarda saklanır.',
  addFailed: (message) => `Evcil hayvan eklenemedi: ${message}`,
};
