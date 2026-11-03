import type { SystemAccessMessages } from './system-access-copy.ts';

export const tr: SystemAccessMessages = {
  cardTitle: (names) => `BaoCut’un ${names} çerezlerini okumasına izin ver`,
  cardBody: "macOS, önce BaoCut’a “Tam Disk Erişimi” vermenizi ister. “Sistem Ayarları’nı Aç”a tıklayın, BaoCut sizi doğrudan o sayfaya götürür. BaoCut yalnızca işaretlediğiniz tarayıcıları okur, başka bir şey okumaz.",
  openedTitle: "Sistem Ayarları’nda BaoCut’u açın, sonra buraya dönün",
  openedBody: "BaoCut’un yanındaki anahtarı açın. macOS BaoCut’u kapatıp yeniden açmak isteyip istemediğinizi sorduğunda “Çık ve Yeniden Aç”ı seçin. BaoCut listede yoksa listenin altındaki “+” ile ekleyin. macOS yeniden açmayı önermezse aşağıdaki “BaoCut’u yeniden başlat”a tıklayın.",
  open: "Sistem Ayarları’nı aç",
  openAgain: "Sistem Ayarları’nı yeniden aç",
  restart: "BaoCut’u yeniden başlat",
  askTitle: (names) => `Önce ${names} çerezlerine erişime izin verilsin mi?`,
  askBody: (names) => `Bu indirme ${names} oturumunuzu kullanır ve macOS, önce BaoCut’a “Tam Disk Erişimi” vermenizi ister. Sistem Ayarları’nda açıp yeniden indirin ya da bu seferlik atlayıp diğer tarayıcılarla devam edin.`,
  skip: "Bu seferlik atla",
  settingLabel: "Tam Disk Erişimi",
  settingAllowed: "İzin verildi. BaoCut harici sürücülerdeki, Masaüstü, Belgeler ve İndirilenler’deki dosyaları ve Safari çerezlerini okuyabilir, ancak yalnızca seçtiğiniz medyayı, kayıt konumlarını ve tarayıcıları okur.",
  settingMissing: "İzin verilmedi. macOS uygulamaların harici sürücüleri, Masaüstü’nü, Belgeler’i, İndirilenler’i ve Safari çerezlerini okumasını engeller. İzin verildiğinde BaoCut bu konumlarda izin yüzünden başarısız olmaz. Yalnızca seçtiğiniz medyayı, kayıt konumlarını ve tarayıcıları okur.",
  openFailed: "Sistem Ayarları açılamadı. Sistem Ayarları › Gizlilik ve Güvenlik › Tam Disk Erişimi’ni kendiniz açın.",
};
