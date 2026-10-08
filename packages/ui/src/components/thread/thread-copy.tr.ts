import type { ThreadMessages } from './thread-copy.ts';

export const tr: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`,
  copy: "Kopyala",
  copied: "Kopyalandı",
  copyFailed: "Kopyalanamadı. Yeniden deneyin",
  copyCode: "Kodu kopyala",
  copyReply: "Bu yanıtı kopyala",
  change: {
    added: (n) => `${n} eklendi`,
    updated: (n) => `${n} değiştirildi`,
    deleted: (n) => `${n} silindi`,
    duration: (clock) => `Süre ${clock}`,
    durationChange: (before,after) => `Süre ${before} → ${after}`,
    revision: (before,after) => `Sürüm ${before} → ${after}`,
    locked: "Video şu anda değiştirilemez",
    undoStep: (videoName,label) => `${videoName} adlı videoda bir adım geri alındı: ${label}`,
    changed: (videoName,label) => `${videoName} adlı video değiştirildi: ${label}`,
    aria: (label) => `Video değişikliği: ${label}`,
  },
  message: {
    contextTitle: "Mesajla gönderilen düzenleyici durumu",
    context: (videoName,revision,playhead,selected) => `“${videoName}” · sürüm ${revision} · oynatma kafası ${playhead}${selected ? ` · ${selected} klip seçili` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}, ${detail}`,
  },
  steps: {
    working: (summary) => `Çalışıyor · ${summary}`,
    failed: (n) => `${n} başarısız`,
    thinking: "Düşünüyor",
    viewFile: (name) => `${name} adlı dosyayı gör`,
    input: "Girdi",
    error: "Hata",
    output: "Çıktı",
    waiting: "Çıktı bekleniyor",
    noOutput: "Çıktı yok",
  },
};
