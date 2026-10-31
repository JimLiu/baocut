import type { RcBotMessages } from './rc-bot.ts';

export const tr: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Ana kanal',
  channelNotFound: (p: { id: string }) => `Kanal bulunamadı: ${p.id}`,
  mainChannelLocked: 'Ana kanal arşivlenemez veya silinemez.',
  channelArchived: 'Bu kanal arşivlendi. Burada çalışmaya devam etmek için geri yükleyin.',
  channelDeleteCountsChanged: 'Bu kanaldaki görev veya zamanlanmış görev sayısı değişti. Silmeden önce yeniden kontrol edin.',
  memoryVersionConflict: 'Belleği açtığınızdan beri içeriği değişti. En son sürümü inceleyip yeniden deneyin.',
  memoryTooLarge: (p: { max: number }) => `Bellek en fazla ${p.max} KB olabilir. Daha fazla eklemeden önce düzenleyin.`,
  memorySensitive: 'Belleğe anahtar, parola, kimlik numarası veya kart numarası koymayın.',
  accessAboveChannelMax: 'Görevin erişim modu kanalın sınırından yüksek olamaz.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Görev bulunamadı: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Bu görev ${p.from} durumundayken "${p.event}" işlemini yapamaz.`,
  textHasLinkOrNumber: 'Görev metninde bağlantı, e-posta adresi veya uzun numara olmamalı. Bunları kaynaklara ekleyin.',
  titleByUser: 'Bu başlığı siz yazdınız, bu yüzden ajan değiştiremez.',
  userTasksNoThread: 'Kendi görevleriniz iş parçacığı başlatmaz.',
  stoppedByYou: 'Bunu siz durdurdunuz.',
  continueOrStop: 'Devam edilsin mi, durdurulsun mu?',
  optionContinue: 'Devam et',
  optionStop: 'Durdur',
  stalledNoProgress: (p: { minutes: number }) => `${p.minutes} dakikadır ilerleme yok.`,
  stalledJobHung: (p: { job: string }) => `${p.job} beklenenden çok daha uzun süredir ses vermiyor.`,
  stalledBudget: 'Bu görev bütçesinin %80’ini kullandı.',
  interruptedOnExit: 'BaoCut en son kapatıldığında yarıda kaldı.',
  threadLost: 'Bu görevin iş parçacığı bulunamıyor.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} şu anda kullanılamıyor, bu yüzden bu görev çalışamadı. Ayarlar'dan kontrol edip devam edin.`,
  needsYouToRun: (p: { agent: string }) => `Bu adım için sizin orada olmanız gerekiyor: ${p.agent} adım adım onay isteyemiyor. Şimdi devam edilsin mi?`,
  approvalWaiting: (p: { summary: string }) => `Onayınızı bekliyor: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Yanıtınız: ${p.text}`,
  youConfirmedDone: 'Tamamlandığını onayladınız.',
  youReopened: 'Bu görevi yeniden açtınız.',
  previousQuestion: (p: { text: string }) => `Önceki soru: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Görev çözüldükten sonra iş parçacığı şunu değiştirdi: ${p.what}.`,
  movedFrom: (p: { channel: string }) => `Şu kanaldan taşındı: ${p.channel}.`,
  queued: (p: { position: number }) => `Boş yer bekleniyor (sıra: ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `${p.video} videosunu ${p.version}. sürümde siz düzenlediniz, bu yüzden yalnızca ajanın değişikliklerini geri almak mümkün değil.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `${p.video} videosunun ${p.version}. sürümünde sizin ve ajanın düzenlemeleri karışık, bu yüzden yalnızca ajanın değişikliklerini geri almak mümkün değil.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Hatırlatma: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} için son tarih ${p.date} idi. Hâlâ açık.`,
  reminderStale: (p: { title: string; days: number }) => `${p.title} ${p.days} gündür sizi bekliyor.`,
  welcome:
    'Merhaba, buradaki asistanınızım. Videolarınızla ne yapmak istediğinizi söyleyin, ben hallederim. Size ihtiyaç olduğunda haber veririm.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Merhaba, buradaki asistanınızım. ${p.projects} projede ${p.videos} video görüyorum. Ne yapmak istediğinizi söyleyin, ben hallederim.`,
  starterSummarize: 'Videoyu özetle',
  starterSummarizeText: 'En son videomu benim için özetle',
  starterCaptions: 'Altyazı ekle',
  starterCaptionsText: 'En son videoma altyazı ekle',
  starterHighlights: 'Öne çıkan anları bul',
  starterHighlightsText: 'En son videomdaki en iyi anları bul',
  markDone: 'Tamamlandı olarak işaretle',
  handoffDriver: (p: { agent: string }) => `${p.agent} ile devam ediliyor.`,
  editedMessage: 'Bu mesajı düzenlediniz.',
  reactionYes: 'Evet',
  reactionNo: 'Hayır',
  approvalNeedsYou: 'Sizi bekleyen bir onay var.',
  makeNoGenerator: 'Bir metin modeli ayarlanmadığı için öneriler kullanılamıyor.',
  scheduleNotReady: 'Zamanlanmış görevler şu anda kullanılamıyor.',
  proposalChannelExists: 'Bu adda bir kanal zaten var.',
  dependencyWaiting: (p: { title: string }) => `"${p.title}" bekleniyor.`,
  lateStart: (p: { minutes: number }) => `${p.minutes} dakika gecikmeyle başladı.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} incelemeniz için hazır`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} yanıtınızı bekliyor`,
  notifyStalled: (p: { title: string }) => `${p.title} takıldı`,
  notifyReminder: (p: { title: string }) => `Hatırlatma: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Bu kart artık kullanılamıyor.',
  proposalHandled: 'Bu kart zaten işlendi.',
  chipStale: 'Bu öneriler güncel değil.',
  userOnly: 'Bunu yalnızca kullanıcı yapabilir.',
  notReady: 'Bot modu henüz hazır değil.',
  automationPaused: 'Otomasyon duraklatıldı.',
};
