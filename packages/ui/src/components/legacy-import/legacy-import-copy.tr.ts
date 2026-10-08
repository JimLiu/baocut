import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const tr: LegacyImportMessages = {
  title: 'Önceki sürümün projeleri içe aktarılsın mı?',
  lead: (n) =>
    `Bu bilgisayarda BaoCut’ın önceki sürümünden ${n} proje var. İçe aktarırsanız bu sürümde düzenlemeye devam edebilirsiniz. Özgün dosyalar oldukları yerde, değişmeden kalır.`,
  found: 'Bulunan projeler',
  destination: 'İçe aktarma konumu',
  resetDefault: 'Varsayılan konumu kullan',
  change: 'Değiştir…',
  pickTitle: 'İçe aktarma konumunu seçin',
  destinationNote: 'Bu klasör Home’da bir proje olarak görünür; önceki her proje içinde bir video olur.',
  hint: 'Atlarsanız BaoCut bir sonraki açılışta yeniden sorar. Hiç içe aktarmamak için “Bir daha hatırlatma” seçeneğini işaretleyin.',
  never: 'Bir daha hatırlatma',
  skip: 'Atla',
  import: 'İçe aktar',
  importing: (n) => `Önceki ${n} proje arka planda içe aktarılıyor`,
  neverDone: 'Önceki projeleri içe aktarmak bir daha hatırlatılmayacak. Özgün dosyalar olduğu gibi kalır.',
  skipped: 'Atlandı. BaoCut bir sonraki açılışta yeniden soracak.',
  failed: (message) => `İçe aktarılamadı: ${message}`,
};
