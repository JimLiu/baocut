import type { BotMessages } from './bot-copy.ts';

export const tr: BotMessages = {
  trayOpen: 'BaoCut’u Aç',
  trayWorking: (count: number) => `Devam eden görevler (${count})`,
  trayNoWorking: 'Devam eden görev yok',
  trayPause: 'Tüm otomasyonu duraklat',
  trayResume: 'Otomasyonu sürdür',
  trayQuit: 'Arka plan hizmetinden çık',
  trayTooltip: 'BaoCut arka plan hizmeti',
  trayTooltipNeedsYou: (count: number) => `BaoCut: sizi bekleyen ${count} iş var`,
  trayTooltipPaused: 'BaoCut: otomasyon duraklatıldı',
  notifyMerged: (count: number, channel: string) => `${channel} kanalında sizi bekleyen ${count} iş var`,
  notifySummary: (count: number) => `Gece boyunca sizi bekleyen ${count} iş birikti`,
  notifyReason: {
    'needs-review': 'İncelemenize hazır',
    'needs-input': 'Yanıtınız gerekiyor',
    reminder: 'Hatırlatıcı',
    'unattended-approval': 'Onayınızı bekliyor',
    stalled: 'Durdu, göz atmanız gerekiyor',
  },
  residentQuitTitle: 'Bot arka planda çalışmaya devam eder',
  residentQuitDetailMac:
    'BaoCut’u kapatsanız da menü çubuğundan zamanlanmış ve devam eden görevleri çalıştırmayı sürdürür. Her şeyi durdurmak için tamamen çıkın.',
  residentQuitDetailOther:
    'BaoCut’u kapatsanız da bildirim alanından zamanlanmış ve devam eden görevleri çalıştırmayı sürdürür. Her şeyi durdurmak için tamamen çıkın.',
  residentKeep: 'Arka planda tut',
  residentQuit: 'Tamamen çık',
  quitServiceTitle: 'Arka plan hizmetinden çıkılsın mı?',
  quitServiceDetail: 'BaoCut’u yeniden açana kadar Bot çalışmaz. Bu sırada zamanı gelen zamanlanmış görevler kaçırıldı olarak kaydedilir.',
  quitServiceThreads: (count: number) => `Devam eden ${count} görev durdurulacak:`,
  quitServiceSchedules: (count: number) => `Zamanlanmış ${count} görev çalışmayacak:`,
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Arka plan hizmetinden çık',
  more: (count: number) => `ve ${count} tane daha`,
  cancel: 'İptal',
};
