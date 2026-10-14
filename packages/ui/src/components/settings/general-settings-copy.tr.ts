import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const tr: GeneralSettingsMessages = {
  interfaceGroup: "Arayüz",
  language: "Dil",
  languageDesc: "Hemen uygulanır; yeniden başlatma gerekmez.",
  languageSystem: (current) => `Sistem (${current})`,
  appearance: "Görünüm",
  appearanceDesc: "Yalnızca bu bilgisayardaki BaoCut pencerelerini etkiler.",
  schemeSystem: "Sistem",
  schemeLight: "Açık",
  schemeDark: "Koyu",

  saveFailed: (message) => `Kaydedilemedi: ${message}`,

  editingGroup: "Düzenleme ve yazıya dökme",
  autoOpen: "Yazıya dökmeden sonra videoyu otomatik aç",
  autoOpenDesc: "Yerel içe aktarmalar için. Bağlantıdan içe aktarma arka planda tamamlanınca yalnızca bildirim gelir; geçerli sayfanız aynı kalır.",
  autoOpenNote: "Henüz bağlanmadı: yazıya dökmeden sonra geçerli sayfanızda kalırsınız; video otomatik açılmaz.",
  lineLength: "Altyazı satırı uzunluğu",
  lineLengthDesc: "Otomatik satır sonları için hedef uzunluğu ayarlar. Elle düzenlediğiniz satırlar etkilenmez.",
  lineLengthNote: (maxChars,custom) => `Henüz bağlanmadı: otomatik satır sonları şu anda satır başına ${maxChars} yarım genişlikli karakterle sabittir (her CJK karakteri iki sayılır).${custom ? ` Kayıtlı değer özeldir (${custom}).` : ''}`,
  cueShading: "Dökümde altyazı aralıklarını gölgele",
  cueShadingDesc: "Her altyazının aralığını hafif gölgeler; nerede bölündüğünü görebilirsiniz.",
  cueShadingNote: "Henüz yapılmadı: döküm altyazı aralıklarını gölgelemez.",

  downloadsGroup: "İndirmeler ve güncellemeler",
  autoUpdateOn: "Otomatik güncelleme denetimi ve indirme açıldı",
  autoUpdateOff: "Otomatik güncelleme indirme kapatıldı",
  downloaderWeb: "Tarayıcı bu bilgisayardaki indirme araçlarını denetlemez; BaoCut masaüstü uygulamasında denetleyin.",

  sourcesGroup: "İndirme kaynakları ve çevrimdışı",
  strictOffline: "Sıkı çevrimdışı",
  strictOfflineDesc: "Açıkken model ve dış araç indirilmez, bağlantılardan video indirilmez. Bulut modellerinin ve Ajan motorlarının internete bağlanmasını etkilemez.",
  strictOfflineOn: "Sıkı çevrimdışı açıldı",
  strictOfflineOff: "Sıkı çevrimdışı kapatıldı",

  trashDays: "Çöp sepetinde tutma süresi (gün)",
  trashDaysDesc: (fallback) => `Çöp sepetinde bu süreden uzun kalan, başvurulmayan öğeler ve silinmiş videolar kalıcı silinir (başlangıçta ve ardından her 6 saatte denetlenir). Hâlâ başvurulan öğeler tutulur. Varsayılana${fallback ? ` (${fallback} gün)` : ''} dönmek için temizleyin.`,
  webNote: "Tarayıcı bu ayarı değiştiremez. Bunu BaoCut masaüstü uygulamasında değiştirin.",
  webViewOnly: "Tarayıcıda bunu yalnızca görüntüleyebilirsiniz. Değişiklikleri BaoCut masaüstü uygulamasında yapın.",
  webUnavailable: "Bu, tarayıcıda kullanılamaz. BaoCut masaüstü uygulamasını kullanın.",
};
