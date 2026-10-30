import type { ForkMessages } from './fork-copy.ts';

export const tr: ForkMessages = {
  button: 'Bu turdan dal oluştur',
  fork: 'Yeni oturumda devam et',
  forkHint: 'Konuşmayı bu tura kadar taşır',
  restore: 'Videoları o ana geri yükleyerek devam et…',
  restoreOne: (name) => `"${name}" bu turun sonuna döner`,
  restoreMany: (n) => `${n} video bu turun sonuna döner`,
  restoreNone: 'O andaki sürümler yok veya okunamıyor',
  checking: 'Sürüm geçmişi denetleniyor…',
  dialogTitle: 'Dal oluştur ve videoları geri yükle',
  dialogLead:
    'Yeni oturum konuşmayı bu tura kadar taşır. Aşağıdaki videolar bu turun sonuna döner. Her geri yükleme yeni bir sürüm olarak kaydedilir; sürüm geçmişinden geri dönebilirsiniz.',
  listLabel: 'Geri yüklenecek videolar',
  cancel: 'İptal',
  confirm: 'Dal oluştur ve geri yükle',
  ok: (version, undone) => `${version}. sürümü geri yükle. Sonraki ${undone} sürüm (sizin ve diğer oturumların değişiklikleri) geri alınır`,
  pruned: 'O andaki sürüm artık yok (sürüm geçmişi yalnızca son ve kaydedilmiş sürümleri tutar)',
  createdAfter: 'Bu video bu turdan sonra oluşturuldu, olduğu gibi kalır',
  chainBroken: 'Sürüm geçmişi o ana kadar okunamıyor',
  done: 'Yeni oturuma dal oluşturuldu',
  doneRestored: (n) => `Yeni oturuma dal oluşturuldu ve ${n} video o ana geri yüklendi. Sürüm geçmişinden geri dönebilirsiniz`,
  failed: (error) => `Dal oluşturulamadı: ${error}`,
  forkedFrom: (title, turn) => `"${title}" oturumundan dal · ${turn}. tura kadar`,
  sourceDeleted: '(özgün oturum silindi)',
  history: (turns, omitted) => `Taşınan geçmiş · ${turns} tur${omitted ? ` (önceki ${omitted} tur atlandı)` : ''}`,
  hideHistory: 'Geçmişi gizle',
};
