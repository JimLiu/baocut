import type { LocalModelsMessages } from './local-models-copy.ts';

export const tr: LocalModelsMessages = {
install: { availableNote: 'İndirmeden önce indirilecek miktar ve kalan disk alanı görünür. İndirmeyi duraklatabilirsiniz; indirilen kısım korunur, sonraki sefer devam eder.', download: 'İndir', complete: 'Tamamla', downloadSize: (size: string) => `${size} indir`, completeSize: (size: string) => `${size} tamamla`, resume: 'İndirmeye devam et', pause: 'Duraklat', cancelDownload: 'İndirmeyi iptal et', discard: 'İndirilen dosyalardan vazgeç', repair: 'Onar…', remove: 'Sil…', more: (id) => `Daha fazla · ${id}`, details: 'Ayrıntılar', hideDetails: 'Ayrıntıları gizle', componentLine: (state, size) => state === 'installed' ? `Yüklü${size ? ` · ${size}` : ''}` : `Eksik${size ? ` · ${size}` : ''}`, sharedWith: (ids) => `Ortak kullanım: ${ids.join(', ')}`, noComponents: 'Bu Runtime bileşen ayrıntılarını bildirmedi.',
  // 确认对话框
  installTitle: (id) => `İndir: ${id}`, repairTitle: (id) => `“${id}” onarılsın mı?`, completeTitle: (id) => `Tamamla: ${id}`, planning: 'İndirilecek içerik belirleniyor…', verifying: 'Bozuk veya eksik dosyalar aranıyor. Büyük dosyalarda sürebilir…', planFailed: 'İndirme planı alınamadı', upToDate: 'Tüm dosyalar mevcut ve doğrulandı. İndirilecek bir şey yok.', completeNote: 'Model zaten yüklü. Yalnızca eksik isteğe bağlı bileşenler indirilir; yüklü dosyalar değiştirilmez.', repairUpToDate: 'Tüm dosyalar sağlam. Yeniden indirilecek bir şey yok.', repairThenCheck: 'Yalnızca bozuk veya eksik dosyalar yeniden indirilir; sağlamlara dokunulmaz. Onarımdan sonra otomatik yeniden denetlenir.', replanned: 'İndirme boyutu az önce değişti. Yeni plan aşağıda; yeniden onaylayın.', source: (url) => `İndirme kaynağı: ${url}`, confirmInstall: (size) => `${size} indir`, confirmRepair: 'Onar', cancel: 'İptal', close: 'Kapat', started: (id) => `${id} indiriliyor · ilerleme bu satırda ve Arka plan görevleri kısmında görünür`,
  // 停下与删除
  paused: (id) => `${id} duraklatıldı · indirilen kısım korundu`, discardTitle: (id) => `${id} için indirilen kısımdan vazgeçilsin mi?`, discardBody: 'Sonraki indirme sıfırdan başlar. Diğer model paketlerinin indirdiği dosyalar ve ortak bileşenler silinmez.', discarded: (id) => `${id} için indirilen kısımdan vazgeçildi`, removeTitle: (id) => `${id} silinsin mi?`, removeConfirm: 'Sil', stopFailed: (text) => `Durdurulamadı: ${text}`, removeFailed: (text) => `Silinemedi: ${text}`, installFailed: (text) => `Son indirme tamamlanmadı: ${text}` },
  shared: {
    title: 'Ortak bileşenler',
    note: 'Bu kategorideki birden çok model bunları kullanır. Her biri bir kez yüklenir ve onu kullanan son model silindiğinde birlikte kaldırılır.',
    summaryRepair: (n: number) => `Tamamlanacak ${n} bileşen`,
    summaryCount: (n: number) => `${n} ortak bileşen`,
    usage: (live: number, all: number) => `${live} yüklü model kullanıyor · toplam ${all} model gerektiriyor`,
    usageNone: (all: number) => `${all} model kullanacak · henüz yüklü model yok`,
    withModel: (size: string | null) => `İlk yüklediğiniz modelle birlikte indirilir${size ? ` · ${size}` : ''}`,
    completeNote: (name: string) => `Ortak bileşenler, onları kullanan bir modelle birlikte indirilir. Yalnızca “${name}” için eksik olanlar eklenir; yüklü dosyalara dokunulmaz.`,
  },
};
