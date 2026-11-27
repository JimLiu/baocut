import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const tr: DownloaderSettingsMessages = {
  lead: 'Bağlantılardan video indirmek için yt-dlp kullanılır. Video indir, bağlantıdan döküm ve ajan bu ayarlarla indirir.',
  toolGroup: 'İndirme aracı',
  cookiesLead: 'İndirmeler tarayıcıdaki oturumunuzu kullanır; böylece giriş gerektiren videolar da indirilebilir. Varsayılan olarak algılanan tüm tarayıcılar kullanılır.',
  autoUpdate: "yt-dlp'yi otomatik güncelle",
  autoUpdateDesc:
    "Günde bir kez yeni bir kararlı sürüm olup olmadığını denetler. Varsa, BaoCut'ın indirdiği kopya sağlama toplamı doğrulandıktan sonra değiştirilir; o zamana kadar mevcut kopyayla indirmeye devam edebilirsiniz. Kendi kurduğunuz yt-dlp değiştirilmez.",
  autoUpdateChecked: (when: string, version: string) => `Son denetim: ${when} · en son sürüm ${version}`,
};
