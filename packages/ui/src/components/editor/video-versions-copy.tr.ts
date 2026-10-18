import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const tr: VideoVersionsMessages = {
  title: 'Sürüm geçmişi',
  close: 'Sürüm geçmişini kapat',
  tipLatest: (version: number) => `En son sürüm: ${version}`,
  tipNone: 'Henüz sürüm yok',
  tipOutside: 'Bu video bir projede değil',
  loading: 'Sürüm geçmişi yükleniyor',
  loadFailed: (message: string) => `Sürüm geçmişi yüklenemedi: ${message}`,
  stateSynced: 'Anlık görüntü güncel',
  stateSyncedDesc: 'Video klasöründeki çalışma alanı anlık görüntüsü mevcut içerikle eşleşiyor.',
  statePending: 'Anlık görüntü yazılıyor',
  statePendingDesc: 'Son değişiklikler birkaç saniye içinde anlık görüntüye ve sürüm geçmişine yazılır.',
  stateConflict: 'Anlık görüntü BaoCut dışında değiştirildi',
  stateConflictDesc: 'Anlık görüntü dosyaları BaoCut’ın en son yazdıklarından farklı. BaoCut bunların üzerine yazmaz.',
  stateMissing: 'Henüz anlık görüntü yok',
  stateMissingDesc: 'Çalışma alanı anlık görüntüsü henüz yazılmadı ya da video.json yok.',
  stateRebuild: 'Yeniden oluşturulmalı',
  stateRebuildDesc: 'Yalnızca çalışma alanı anlık görüntüsü var, video kitaplığı yok. BaoCut video açılırken videoyu bu görüntüden yeniden oluşturur.',
  footer: (keep: number) =>
    `Sürümler video klasöründeki .bcut-snapshot/history/ dizininde tutulur ve git’e bağlı değildir. BaoCut en son ${keep} adsız sürümü ve kaydedilen tüm sürümleri tutar.`,
  save: 'Sürümü kaydet',
  saveIntro: 'Mevcut içeriği adlandırılmış bir sürüm olarak kaydedin. Kaydedilen sürümler hiçbir zaman otomatik temizlenmez; yalnızca siz silebilirsiniz.',
  nameLabel: 'Ad',
  namePlaceholder: 'Örneğin: İnceleme kurgusu',
  nameRequired: 'Bu sürüme bir ad verin',
  noteLabel: 'Not (isteğe bağlı)',
  cancel: 'İptal',
  saveSubmit: 'Kaydet',
  conflictTitle: 'Anlık görüntü BaoCut dışında değiştirildi',
  conflictIntro: 'Bu anlık görüntü dosyaları BaoCut’ın en son yazdıklarından farklı. Değişiklik git pull, bir eşitleme sürücüsü veya elle düzenlemeden gelmiş olabilir:',
  conflictOutro: 'BaoCut bunların üzerine yazmaz ve yeni sürüm yazmaz. Bu sorun çözülene kadar sürüm kaydedemez ve sürümlere dönemezsiniz.',
  refusedBroken: 'Bu sürüme dönülemiyor',
  refusedOther: 'Yapılmadı',
  refusedText: (message: string) => `${message}. Video değişmedi.`,
  savedTitle: (version: number, name: string) => `Sürüm ${version} “${name}” olarak kaydedildi`,
  savedText: 'Kaydedilen sürümler kalır; saklama kuralı onları hiçbir zaman silmez.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `${version} sürümünden öncesine dönüldü, ${recorded} sürümü olarak kaydedildi`
      : `${version} sürümüne dönüldü, ${recorded} sürümü olarak kaydedildi`,
  restoredText: 'Bu sıradan bir değişikliktir: burada veya bu pencereyi kapattıktan sonra düzenleyicide geri alabilirsiniz.',
  undo: 'Geri al',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Geri alındı: ${version} sürümünden öncesine dönüş` : `Geri alındı: ${version} sürümüne dönüş`,
  undoneText: 'Video önceki içeriğine döndü. Geri alma işleminin kendisi de bir değişikliktir ve en son sürüme girer.',
  noopTitle: 'Değişiklik yok',
  noopText: (version: number, before: boolean) =>
    before
      ? `Video zaten ${version} sürümü başlamadan önceki durumunda. Hiçbir değişiklik işlenmedi ve yeni sürüm oluşturulmadı.`
      : `Video zaten ${version} sürümünün sonundaki durumunda. Hiçbir değişiklik işlenmedi ve yeni sürüm oluşturulmadı.`,
  deletedTitle: (name: string) => `Kaydedilen “${name}” sürümü silindi`,
  deletedText: 'Video içeriği değişmedi.',
  emptyTitle: 'Henüz sürüm yok',
  emptyText: (missing: boolean): string =>
    missing
      ? 'Çalışma alanı anlık görüntüsü henüz yazılmadı. Sonraki değişikliğiniz sürüm 1 olur; isterseniz şimdi bir sürüm de kaydedebilirsiniz.'
      : 'Sonraki değişikliğiniz sürüm 1 olur; isterseniz şimdi bir sürüm de kaydedebilirsiniz.',
  outsideTitle: 'Bu video bir projede değil',
  outsideText: 'Sürüm geçmişi yalnızca projedeki videolar için tutulur. Önce videoyu bir projeye taşıyın.',
  listLabel: 'Sürümler',
  versionN: (version: number) => `Sürüm ${version}`,
  openBadge: 'Hâlâ açık',
  blockedFlag: 'Dönülemez',
  unreadableTitle: 'Bu sürüm dosyası okunamıyor',
  kindSegment: 'Düzenlemeler',
  kindSave: 'Kaydedilen sürüm',
  kindRestore: 'Sürüme dönüş',
  kindExternal: 'Harici değişiklik',
  kindRebuild: 'Yeniden oluşturma',
  revisions: (from: string, to: string) => (from === to ? `Revizyon ${to}` : `Revizyon ${from}–${to}`),
  openHint: 'En son sürüm hâlâ açık: 5 dakika değişiklik olmayana veya sürüm 30 dakikayı doldurana kadar sonraki değişiklikleriniz bu sürüme girer.',
  openHintPending: 'En son sürüm hâlâ açık. Son değişiklikler yazılıyor ve birkaç saniye içinde bu sürüme girecek.',
  openHintConflict: 'En son sürüm hâlâ açık, ancak anlık görüntü çakışması çözülene kadar yeni değişiklikler sürüm geçmişine girmez.',
  restoreEnd: 'Bu sürüme dön',
  restoreBefore: 'Bu sürümden öncesine dön',
  deleteSaved: 'Kaydedilen bu sürümü sil',
  whyNotFound: 'Bu sürüm artık yok',
  whyUnreadable: (version: number) => `${version} sürümünün dosyası okunamıyor; bu sürüme ve daha önceki durumlara dönülemez`,
  whyBroken: (version: number) => `Sürüm geçmişi ${version} sürümünde uyuşmuyor; daha önceki durumlara dönülemez`,
  noopBoth: (version: number) =>
    `Video zaten ${version} sürümünün durumunda (bu sürümün öncesi ve sonrası aynı içerikte); bu sürüme dönmek hiçbir şeyi değiştirmez`,
  noopEnd: (version: number) => `Video zaten ${version} sürümünün sonundaki durumunda; bu sürüme dönmek hiçbir şeyi değiştirmez`,
  noopBefore: (version: number) => `Video zaten ${version} sürümü başlamadan önceki durumunda; oraya dönmek hiçbir şeyi değiştirmez`,
  factActors: 'Değiştiren',
  factConversations: 'Oturumlar',
  factFiles: 'Neler değişti',
  factCheckpoint: 'Kontrol noktası',
  actorYou: 'Siz',
  actorAgent: 'Ajan',
  actorExternal: (name: string) => `Dış hizmet ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Kaydedilmiş değişiklik yok',
  noActionsRebuild: 'BaoCut videoyu anlık görüntüsünden yeniden oluşturdu; içerik değişmedi',
  omitted: (count: number) => (count === 1 ? '1 değişiklik daha yalnızca sayıldı' : `${count} değişiklik daha yalnızca sayıldı`),
  notHere: '(bu bilgisayarda değil)',
  openConversation: (title: string) => `“${title}” oturumunu aç`,
  fileTimeline: 'Zaman çizelgesi',
  fileDocument: 'Belge',
  changeAdd: 'Eklendi',
  changeDelete: 'Silindi',
  changeModify: 'Değiştirildi',
  noFiles: 'İçerik değişmedi',
  diffTitle: 'Değişiklikler',
  copyDiff: 'Diff’i kopyala',
  copied: 'Kopyalandı',
  copyFailed: 'Kopyalanamadı. Metni seçip elle kopyalayın.',
  diffEmpty: 'Bu sürümün diff’i boş: içerik önceki sürümün sonundakiyle aynı.',
  diffLabel: (version: number) => `${version} sürümünün diff’i`,
  diffLoading: 'Diff yükleniyor',
  diffFailed: (message: string) => `Bu sürüm okunamadı: ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? '1 satır daha gösterilmiyor. Tamamını görmek için diff’i kopyalayın.'
      : `${count} satır daha gösterilmiyor. Tamamını görmek için diff’i kopyalayın.`,
  unreadableHeading: (file: string) => `${file} okunamıyor`,
  unreadableText: (why: string) =>
    `Sürüm dosyasının başlığı veya diff’i bozuk; dosya kesilmiş ya da elle düzenlenmiş olabilir. ${why}. Daha yeni sürümler etkilenmez.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `${version} sürümünden öncesine dönülsün mü?` : `${version} sürümüne dönülsün mü?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `${
      before
        ? `Videonun içeriği, ${version} sürümü başlamadan önceki durumuyla (${when}) değiştirilecek.`
        : `Videonun içeriği, ${version} sürümünün sonundaki durumuyla (${when}) değiştirilecek.`
    } Bu, geri alabileceğiniz bir değişikliktir ve yeni bir sürüm olarak kaydedilir. Mevcut sürümler kalır; kontrol noktaları ve korumalar değişmez.`,
  confirmDeleteTitle: (name: string) => `Kaydedilen “${name}” sürümü silinsin mi?`,
  confirmDeleteMiddle: (next: number) =>
    `Yalnızca bu sürüm ve kontrol noktası silinir: değişiklikleri hemen sonraki ${next} sürümüne katılır. Video içeriği değişmez.`,
  confirmDeleteTop:
    'Yalnızca ad, not ve kontrol noktası kaldırılır: bu sürüm sıradan bir düzenleme dizisine dönüşür ve sonraki değişiklikler bu sürüme katılır. Video içeriği değişmez.',
  delete: 'Sil',
};
