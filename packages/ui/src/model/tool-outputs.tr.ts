import type { ToolOutputsMessages } from './tool-outputs.ts';

export const tr: ToolOutputsMessages = {
  actionLabel: { 'open-movie': 'Düzenleyicide aç', 'new-movie': 'Bundan yeni video oluştur' },
  blockTextOnly: 'Yeni video oluşturmak için döküm ve altyazılara bir video veya ses dosyası gerekir; henüz buradan yapılamıyor',
  blockTrashed: 'Önce bu öğeyi Çöp sepetinden geri yükleyin',
  blockGenerating: 'Hâlâ oluşturuluyor; tamamlanınca kullanılabilir',
  blockMissing: 'Bu sonucun bu bilgisayardaki dosyası bulunamıyor',
  handover: {
    subtitle: 'Bu altyazıları zaman kodlarını değiştirmeden başka bir dile çevir.',
    document: 'Bu dökümün özetini yaz.',
    audio: 'Bu sesle bir video oluştur.',
    image: 'Bu görseli kapak olarak kullanarak bir video oluştur.',
    'video-file': 'Bu videoya altyazı ekle.',
    export: 'Bu videoya altyazı ekle.',
    video: 'Bu videoyu düzenlemeye devam et.',
  },
  handoverDefault: 'Bu sonuç üzerinde çalışmaya devam et.',
};
