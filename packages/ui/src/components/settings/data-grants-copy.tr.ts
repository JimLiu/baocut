import type { DataGrantsMessages } from './data-grants-copy.ts';

export const tr: DataGrantsMessages = {
  title: "Veri paylaşımı izinleri",
  showEnded: (count) => `Sona erenleri göster (${count})`,
  lead: "Bulut sağlayıcılarına veri göndermek için izin gerekir: sağlayıcıyı etkinleştirince varsayılan bir izin, onay sırasında “Her zaman izin ver” seçince de başka bir izin verilir. İzni iptal edince yeni çağrılar veri göndermez; gönderilmiş veri ve oluşmuş ücret geri alınamaz. Yerel modeller izin gerektirmez.",
  loading: "İzinler yükleniyor…",
  disconnected: "Runtime bağlı değil",
  revoke: "İptal et",
  noActive: "Etkin izin yok",
  none: "Henüz izin yok",
  emptyDesc: "Bulut sağlayıcısını etkinleştirince veya onay sırasında “Her zaman izin ver” seçince izinler burada görünür.",
  revokeTitle: (name) => `${name} adlı izin iptal edilsin mi?`,
  revokeFailed: (message) => `İptal edilemedi: ${message}`,
  cancel: "İptal",
};
