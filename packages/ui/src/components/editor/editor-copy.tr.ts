import type { EditorMessages } from './editor-copy.ts';

export const tr: EditorMessages = {
withNote: (label, note) => `${label} (${note})`, labeled: (label, value) => `${label}: ${value}`, thenNext: (message, next) => `${message}. ${next}`, gap: ' ', undo: 'Geri al', redo: 'Yinele', cancel: 'İptal', retry: 'Yeniden dene', addClip: 'Klip ekle', editor: 'Düzenleyici', notEditableNow: 'Video şu anda düzenlenemiyor', timeline: 'Zaman çizelgesi', moveClips: 'Klipleri taşı', importAndAdd: 'Medya içe aktar ve ekle', seconds2: (seconds) => `${seconds.toFixed(2).replace('.', ',')} sn`, emptyTimeline: 'Medyayı buraya sürükleyin veya sağ panelden ekleyin', hideTrack: (label) => `Gizle: ${label}, önizlemede gösterilmez`, showTrack: (label) => `Göster: ${label}`, hideTrackLabel: 'İzi gizle', showTrackLabel: 'İzi göster', unmuteTrack: (label) => `Sesi aç: ${label}`, muteTrack: (label) => `Sesi kapat: ${label}`, unmuteTrackLabel: 'Sesi aç', muteTrackLabel: 'İzin sesini kapat', unlockTrack: (label) => `Kilidi aç: ${label}`, lockTrack: (label) => `Kilitle: ${label}, klipleri taşınamaz, kısaltılamaz veya silinemez`, unlockTrackLabel: 'İzin kilidini aç', lockTrackLabel: 'İzi kilitle', playTip: { play: 'Oynat · Space', pause: 'Duraklat · Space', replay: 'Yeniden oynat' }, playLabel: { play: 'Oynat', pause: 'Duraklat', replay: 'Yeniden oynat' }, undoTip: (label, keys) => `Geri al: “${label}” ${keys}`, redoTip: (label, keys) => `Yinele: “${label}” ${keys}`, nothingToUndo: 'Geri alınacak bir şey yok', nothingToRedo: 'Yinelenecek bir şey yok', splitTip: 'Oynatma kafasında böl · S', split: 'Böl', splitClips: 'Klipi böl', deleteTip: 'Seçimi sil · Delete', deleteSelected: 'Seçimi sil', playhead: 'Oynatma kafası konumu', totalLength: (duration) => `Toplam süre ${duration}`, editFailed: (message) => `Değişiklik yapılamadı: ${message}`, cantOpen: 'Bu video açılamıyor', openingAria: 'Video açılıyor', opening: 'Video açılıyor…', resizeTimeline: 'Zaman çizelgesini yeniden boyutlandır', workingDraft: 'Çalışma taslağı', previewCanvas: 'Önizleme', previewFailed: 'Önizleme çizilemiyor', emptyDrag: 'Medyayı zaman çizelgesine sürükleyin', emptyOr: 'veya sağ medya panelinden ekleyin', problemsCount: (n) => `${n} öğe çizilemiyor`, problemsTitle: 'Bu karedeki bazı içerikler çizilemiyor', rendererFailed: (message) => `Önizleme işleyicisi yüklenmedi: ${message}`, spectrumTooLarge: (itemId, assetId, mb) => `Dalga formu ${itemId}: ${assetId} medyası ${mb} MB üzerinde; önizleme sesini analiz etmez, dışa aktarma etkilenmez`,
  stall: {
    loading: 'Önizleme yükleniyor',
    title: 'Önizleme takıldı',
    engine: 'Önizleme motoru hâlâ yükleniyor',
    video: 'Bu video hâlâ hazırlanıyor',
    media: (name: string) => `Medya bekleniyor: ${name}`,
    mediaUnnamed: 'Medya bekleniyor',
    preparing: 'Önizleme hazırlanıyor',
    converting: (name: string) => `Oynatılabilmesi için dönüştürülüyor: ${name}`,
    convertingUnnamed: 'Medya oynatılabilmesi için dönüştürülüyor',
    once: 'Bu yalnızca ilk açılışta olur. Orijinal dosyanız değişmez.',
    prepare: (name: string) => `Medya dönüştürme ilerlemiyor: ${name}`,
    prepareUnnamed: 'Medya dönüştürme ilerlemiyor',
    captions: (name: string) => `Altyazılar bekleniyor: ${name}`,
    captionsUnnamed: 'Altyazılar bekleniyor',
    fonts: (name: string) => `Yazı tipleri bekleniyor: ${name}`,
    paint: 'Görüntü güncellenmeyi bıraktı',
    body: (seconds: number) => `${seconds} sn beklendi. Yeniden denemek yalnızca önizlemeyi yeniden yükler; videonuz değişmez.`,
  },
};
