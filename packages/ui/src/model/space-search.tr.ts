import type { SpaceSearchMessages } from './space-search.ts';

export const tr: SpaceSearchMessages = {
documentKind: { speech: 'Döküm', caption: 'Altyazı', translation: 'Çeviri', chapter: 'Bölüm' }, pendingVideos: (count) => `${count} videonun içerik dizini güncellenmedi; sonuçlarda eksik video veya eski bilgi olabilir`, indexUpdating: 'İçerik dizini güncelleniyor; sonuçlar eski olabilir', truncated: (count) => `Çok fazla eşleşme; yalnızca ilk ${count} gösteriliyor`, notes: (notes) => `${notes.join('; ')}.`, sourceTime: (clock) => `Medya zamanı ${clock}`,
};
