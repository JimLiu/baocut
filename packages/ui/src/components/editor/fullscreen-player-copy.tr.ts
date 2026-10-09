import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const tr: FullscreenPlayerMessages = {
  region: 'Tam ekran oynatıcı',
  enter: 'Tam ekran oynat',
  enterTip: 'Tam ekran oynat (F)',
  captions: 'Altyazı',
  captionsTip: (mode: string) => `Altyazı: ${mode} (C)`,
  captionMode: { off: 'Altyazı kapalı', source: 'Özgün', trans: 'Çeviri', both: 'İki dilli' },
  keysTip: 'Klavye kısayolları (?)',
  keysTitle: 'Klavye kısayolları',
  keysFooter: 'Bu listeyi kapatmak için Esc’e, tam ekrandan çıkmak için tekrar Esc’e basın.',
  keys: {
    play: 'Oynat / duraklat (görüntüye tek tıklamayla aynı)',
    exit: 'Tam ekrandan çık (görüntüye çift tıklamayla aynı)',
    back: '5 saniye geri / ileri',
    back10: '10 saniye geri / ileri',
    prevChapter: 'Önceki / sonraki bölüm',
    volUp: 'Ses ±10 (sessizi otomatik kaldırır)',
    mute: 'Sessize al / sesi aç',
    captions: 'Altyazı modunu değiştir',
    start: 'Başa / sona git',
    percent: 'Videonun %0 – %90 noktasına git',
    keys: 'Bu liste',
  },
};
