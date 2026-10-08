import type { FontsMessages } from './fonts-copy.ts';

export const tr: FontsMessages = {
help: `Kullanım:
  baocut fonts [downloaded]        İndirilen yazı tipleri (Google Fonts, gerektiğinde indirilir):
                                   aile, kalınlıklar, boyut, lisans ve toplam boyut
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Yazı tipi seçici listesi: uygulamayla gelen, bu bilgisayardaki ve katalogdaki
                                   aileler ve durumları (yerleşik, bu bilgisayarda, indirildi, indirilebilir,
                                   indiriliyor, başarısız). Kategoriler: sans-serif, serif, display, handwriting,
                                   monospace; yazı sistemleri: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Aile indir (varsayılan normal ve kalın); ilerleme stderr üzerine gider, Ctrl-C
                                   iptal eder. Yalnızca aile adı ve kalınlıklar gönderilir; yansılar için
                                   fonts.cssEndpoint ve fonts.fileEndpoint ayarlarına bakın; katı çevrimdışı modda reddedilir
  baocut fonts remove <family>     Bu ailenin indirilen yazı tiplerini sil (tamamlanmamış dışa aktarma kullanıyorsa reddedilir)
  baocut fonts clear               İndirilen yazı tiplerini temizle (tamamlanmamış dışa aktarmada kullanılanlar korunur)`,
alreadyDownloaded: (family) => `“${family}” zaten indirildi`, downloadDone: 'İndirme tamamlandı', remedy: (text) => `Çözüm: ${text}`, usage: 'Kullanım: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear', listSep: ', ', categoryChoices: (choices) => `--category şunlardan biri olmalı: ${choices.join(', ')}`, scriptChoices: (choices) => `--script şunlardan biri olmalı: ${choices.join(', ')}`, limitRange: '--limit 1–500 arasında tam sayı olmalı', italicNeedsWeights: '--italic, --weights ile kullanılır', weightsFormat: '--weights 1–1000 arasında virgülle ayrılan kalınlıklar kabul eder', stateLabels: { 'built-in': 'Yerleşik', installed: 'Bu bilgisayarda', downloaded: 'İndirildi', downloadable: 'İndirilebilir', downloading: 'İndiriliyor', failed: 'Başarısız', unavailable: 'Kullanılamıyor' }, face: (weight, italic) => `${weight}${italic ? ' italik' : ''}`, noDownloads: 'Henüz indirilmiş yazı tipi yok', downloadedTotal: (families, faces, size) => `${families} aile, ${faces} kalınlık, toplam ${size}`, noMatches: 'Eşleşen yazı tipi yok', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(toplam ${total}, ilk ${shown} gösteriliyor)`, removed: (count, freed) => `${count} kalınlık silindi, ${freed} boşaltıldı`, nothingToRemove: 'Silinecek yazı tipi yok', kept: (count, faces) => `${count} korundu (tamamlanmamış dışa aktarmada kullanılıyor): ${faces.join(', ')}`,
};
