import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const tr: FontSettingsMessages = {
  lead: (total) => `Yazı tipleri üç kaynaktan gelir: uygulamayla gelenler, bu bilgisayarda yüklü olanlar ve Google Fonts dizini (${total === null ? 'yaklaşık iki bin' : `yaklaşık ${total.toLocaleString(intlLocale())}`} aile, açık kaynak lisansları, gerektiğinde indirilir). İndirme yalnızca aile adını ve kalınlığını gönderir; hesap gerekmez. Yazı tipleri video klasöründe değil, uygulama verilerinde saklanır.`,
  download: "İndir",
  autoDownload: "Yazı tiplerini otomatik indir",
  autoDownloadDesc:
    "Önizleme, video açma veya dışa aktarma sırasında bu bilgisayarda olmayan yazı tipini Google Fonts üzerinden indirir. Kapalıyken önce görüntüleme ve dışa aktarma için yedek yazı tipleri kullanılır; yazı tipi seçerken yine elle indirebilirsiniz. Sıkı çevrimdışı modda indirme yapılmaz.",
  cssEndpoint: "Stil sayfası URL adresi",
  cssEndpointDesc: "Aynanın temel URL adresi. https://fonts.googleapis.com kullanmak için boş bırakın.",
  fileEndpoint: "Yazı tipi dosyası URL adresi",
  fileEndpointDesc: "Yazı tipi dosyaları yalnızca bu URL altından alınır. https://fonts.gstatic.com kullanmak için boş bırakın.",
  downloaded: "İndirilen yazı tipleri",
  summary: (families,size) => `${families} aile · ${size}`,
  none: "Henüz yok",
  clearAll: "Tümünü temizle",
  empty: "Yazı tipi seçerken veya video açma ve dışa aktarma sırasında otomatik indirilen yazı tipleri burada listelenir.",
  clearTitle: "İndirilen yazı tipleri temizlensin mi?",
  clear: "Temizle",
  cancel: "İptal",
  removed: (family,size) => `${family} adlı yazı tipi silindi · ${size} boşaltıldı`,
  inUseTip: "Tamamlanmamış dışa aktarma bunu kullanıyor; işlem bitince silin",
  removeTip: "Bu yazı tipinin indirilen dosyalarını sil",
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights,size,licence,ago) => `Kalınlıklar ${weights} · ${size} · ${licence}${ago ? ` · indirildi: ${ago}` : ''}`,
  inUse: "Dışa aktarma kullanıyor",
};
