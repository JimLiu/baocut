import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const tr: ToolSpaceInputMessages = {
  reasons: {
    trashed: 'Çöp sepetinde',
    generating: 'Hâlâ oluşturuluyor; tamamlanınca seçebilirsiniz',
    missing: 'Dosya eksik; seçmeden önce yeniden bağlayın',
    failed: 'Son oluşturma başarısız oldu',
    textOnly: 'Yalnızca .txt ve .md belgelerindeki metin okunabilir',
    subtitleOnly: 'Yalnızca .srt ve .vtt altyazıları kabul edilir',
    noPath: 'Bu öğenin bu bilgisayarda dosyası yok; yeni video yerel bir dosyayla başlamalı',
  },
  joinKinds: (labels) => labels.join(', '),
};
