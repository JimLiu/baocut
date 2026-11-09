import type { DoctorMessages } from './doctor-copy.ts';

export const tr: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    "BaoCut neden başlamıyor veya bir şeyi okuyamıyor: terminallerin hangi baocut komutunu bulduğu, CLI'ın hangi",
    "Runtime'ı hangi dizinle başlatacağı, kimlik bilgisi deposunun yanıt verip vermediği ve macOS'ta Tam Disk",
    'Erişimi. Her denetimin sonucu ok, warn, fail veya skip olur; varsa bir çözüm komutu da verilir. next ilk',
    'sorunun çözümüdür. Salt okunur: hiçbir zaman Runtime başlatmaz ve anahtar okumaz (anahtar zinciri denetimi',
    'yalnızca uydurma bir anahtarın var olup olmadığını sorar). Çözümleri çalıştırmadan önce kullanıcıya sorun.',
    'Depo kopyasından çalışırken Runtime öz denetimini de çalıştırır: her yerel programı bir kez başlatır ve derlemeleri kaynak kodla karşılaştırır.',
    '',
    'Seçenekler: --json',
  ].join('\n'),
  checkName: {
    entry: 'Komut satırı',
    runtime: 'Runtime',
    credentials: 'Kimlik bilgileri',
    fullDiskAccess: 'Tam Disk Erişimi',
    build: 'Derleme',
  },
  remedyLabel: 'çözüm',

  entryApp: (found, version) => `Terminaller ${found} komutunu çalıştırıyor: BaoCut${version ? ` ${version}` : ''} uygulamasının komut satırı`,
  entryOtherApp: (found, target, app) =>
    `Terminaller ${found} (${target}) komutunu çalıştırıyor; ${app} konumundaki BaoCut uygulamasının komut satırını değil`,
  entryNoApp: (found, target) => `Terminaller ${found} (${target}) komutunu çalıştırıyor; BaoCut uygulaması bulunamadı`,
  entryMissing: 'Terminaller baocut komutunu bulamıyor. BaoCut uygulamasından yükleyin (yönetici hakları gerekmez).',
  entryMissingNoApp: 'Terminaller baocut komutunu bulamıyor ve olağan konumlarda BaoCut uygulaması bulunamadı',

  runtimeRunning: (version, pid, by) =>
    `Çalışıyor: sürüm ${version}, işlem ${pid}, ${by === 'cli' ? 'komut satırı' : 'BaoCut uygulaması'} tarafından başlatıldı`,
  runtimeStopped: (entry) => `Çalışmıyor. Sonraki komut onu ${entry} ile arka planda başlatır`,
  runtimeUnreachable: (pid, reason) => `Bir Runtime çalışıyor (işlem ${pid}) ancak yanıt vermiyor: ${reason}`,
  runtimeNoLaunch:
    'Çalışmıyor ve başlatılacak bir Runtime yok: BaoCut uygulamasını yükleyin, depodan çalıştırın veya BAOCUT_RUNTIME_ENTRY değerini Runtime girişine ayarlayın.',

  credentialsFile: (file) => `Bu derleme anahtarları bir dosyada tutuyor: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Windows Kimlik Bilgileri Yöneticisi yanıt veriyor' : 'macOS Anahtar Zinciri yanıt veriyor',
  credentialsDenied:
    'Anahtar zinciri erişimi reddetti. SSH üzerinden veya masaüstünde oturum açılmamışken macOS onu kilitli tutabilir: baocut komutunu masaüstündeki bir terminalde çalıştırın veya giriş anahtar zincirinin kilidini açın.',
  credentialsNoHelper: (file) =>
    `Kimlik bilgisi yardımcısı eksik${file ? ` (${file})` : ''}, bu yüzden anahtarlar okunamıyor. BaoCut uygulamasını yeniden yükleyin.`,
  credentialsUnavailable: (reason) => `Kimlik bilgisi deposuna ulaşılamadı: ${reason}`,
  credentialsUnknown: 'Anahtarların nerede tutulacağına BAOCUT_RUNTIME_ENTRY karar verir; denetlenmedi',
  credentialsTimedOut: (seconds) => `yardımcı ${seconds} sn içinde yanıt vermedi`,

  fdaGranted: 'Tam Disk Erişimi açık',
  fdaMissingApp:
    "BaoCut.app için Tam Disk Erişimi kapalı, bu yüzden korunan konumlardaki (Masaüstü, Belgeler, İndirilenler, diğer diskler) dosyalar okunamayabilir. Sistem Ayarları › Gizlilik ve Güvenlik › Tam Disk Erişimi bölümünde BaoCut'ı açın, ardından baocut doctor komutunu yeniden çalıştırın.",
  fdaMissingCli: (app) =>
    `Komut satırının başlattığı Runtime için Tam Disk Erişimi kapalı; macOS bunu şu uygulamanın iznine göre değerlendirir: ${app ?? 'komutu çalıştıran uygulama (terminaliniz veya ajanı barındıran uygulama)'}. O uygulamayı Sistem Ayarları › Gizlilik ve Güvenlik › Tam Disk Erişimi bölümünde açıp yeniden başlatın ya da bu Runtime'ı durdurup (baocut runtime stop) BaoCut uygulamasını açın; ardından baocut doctor komutunu yeniden çalıştırın.`,
  fdaNotRunning: 'Yalnızca bir Runtime çalışırken denetlenir',
  buildOk: (count) => `Yerel programlar başlıyor ve ${count} derleme kaynak kodla eşleşiyor`,
  buildNotSource: 'Runtime depo kopyasından çalışırken denetlenir',
  buildFailed: (reason) => `Runtime öz denetimi bitmedi: ${reason}`,
  buildTimedOut: (seconds) => `${seconds} sn içinde yanıt yok`,
  buildProblems: (count, first) =>
    count === 1 ? `Runtime öz denetimi bir sorun buldu: ${first}` : `Runtime öz denetimi ${count} sorun buldu, ilki: ${first}`,
  buildMore: (first, more) => `${first} (${more} tane daha)`,
};
