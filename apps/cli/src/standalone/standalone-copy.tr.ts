import type { StandaloneMessages } from './standalone-copy.ts';

export const tr: StandaloneMessages = {
  cliHelp: `Kullanım:
  baocut cli install               Bu komut satırı paketini kullanıcınız için yükler ve baocut'ı PATH'e koyar. Paket, zaten
                                   orada değilse ~/.local/share/baocut/versions/<sürüm> konumuna kopyalanır (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<sürüm>). macOS: ~/.local/bin/baocut konumunda
                                   bir bağlantı. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, bu klasör kullanıcı
                                   PATH'inize eklenir. Yönetici hakları gerekmez
  baocut cli status                baocut'ın nerede olduğu, yüklü hangi sürüme işaret ettiği ve terminalinizin hangi
                                   baocut'ı bulduğu
  baocut cli remove                baocut cli install'ın koyduğunu kaldırır; yüklü sürümler kalır. O konumda BaoCut'ın
                                   koymadığı bir şey asla değiştirilmez veya silinmez`,
  help: `baocut update [--check | --rollback]

Bağımsız komut satırı paketini günceller: BaoCut uygulamasıyla aynı sürüm akışını okur, en yeni sürümün komut satırı
paketini indirir, boyutunu ve sha256 değerini (macOS'ta ayrıca imzasını ve noter onayını) denetler, mevcut sürümün
yanına yükler ve baocut'ı ona yönlendirir. Önceki sürüm --rollback için saklanır; artık hiçbir Runtime'ın
kullanmadığı daha eski sürümler silinir.
  --check      Yalnızca daha yeni bir sürüm olup olmadığını söyler
  --rollback   Önceki sürüme döner
Zaten çalışan bir Runtime, durana kadar eski sürümü kullanır (baocut runtime stop).
Yalnızca bağımsız paket bu şekilde güncellenir: BaoCut uygulaması kendini günceller, Homebrew kurulumu brew upgrade ile.
Başka bir akışı okumak için BAOCUT_UPDATE_APPCAST değişkenini ayarlayın (bir URL veya yerel dosya; test için).`,
  version: (version, build) => `${version} (Derleme ${build})`,
  state: {
    none: 'Yüklü değil',
    current: 'Mevcut sürüme işaret ediyor',
    stale: "Başka bir BaoCut'a işaret ediyor",
    broken: 'Artık var olmayan bir konuma işaret ediyor',
    foreign: 'Orada başka bir şey var (dokunulmadı)',
  },
  statusPackage: (version, root) => `Paket     ${version}  ${root}`,
  statusVersions: (versions, root) => `Yüklü     ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `${root} içinde henüz yüklü bir sürüm yok: baocut cli install bu paketi oraya kopyalar`,
  currentMark: ' (mevcut)',
  previousMark: ' (önceki)',
  copied: (dest, from) => `Paket ${dest} konumuna kopyalandı; ${from} artık gerekmiyor`,
  versionsKept: (dir) => `Yüklü sürümler ${dir} içinde kalır: onları kaldırmak için bu klasörü silin`,
  entryTaken: (path) =>
    `${path} BaoCut'ın koyduğu bir şey değil, bu yüzden dokunulmadı. Kendiniz taşıyın veya silin, ardından baocut cli install komutunu yeniden çalıştırın`,
  pathFailed: (dir) => `${dir} kullanıcı PATH'inize eklenemedi: Sistem Özellikleri → Ortam Değişkenleri bölümünden ekleyin`,
  copyFailed: (from, dest, detail) => `${from}, ${dest} konumuna kopyalanamadı${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update, --check veya --rollback alır (yalnızca biri): ${token}`,
  updateUnavailable:
    "baocut update bağımsız komut satırı paketini günceller. Bu baocut, kendini güncelleyen BaoCut uygulamasına (BaoCut → Güncellemeleri denetle) ya da Homebrew'a (brew upgrade --cask baocut) ait",
  upToDate: (current) => `Güncel: ${current}`,
  available: (latest, current) => `${latest} kullanılabilir (sizdeki: ${current})`,
  downloading: (version, build, megabytes) => `${version} (Derleme ${build}) indiriliyor, ${megabytes} MB…`,
  updated: (from, to) => `Güncellendi: ${from} → ${to}`,
  rolledBack: (from, to) => `${from} sürümünden ${to} sürümüne geri dönüldü`,
  rollbackHint: 'Geri dönmek için: baocut update --rollback',
  entrySwitched: (path) => `${path} artık bu sürüme işaret ediyor`,
  entryNotInstalled: (path) => `${path} yüklü değil: baocut cli install, baocut'ı PATH'e koyar`,
  entryLeftAlone: (path) =>
    `${path} bu paketten başka bir şeye işaret ediyor ve dokunulmadı: baocut cli install onu buraya yönlendirir`,
  removedVersions: (versions) => `Eski sürümler silindi: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Bir Runtime (pid ${pid}) hâlâ başladığı sürümle çalışıyor; durduğunda sonraki komut yenisini başlatır (baocut runtime stop onu şimdi durdurur)`,
  systemTooOld: (required, system) => `Yeni sürüm macOS ${required} gerektiriyor; bu Mac'te ${system} var`,
  feedFailed: (url, detail) => `${url} sürüm akışı okunamadı: ${detail}`,
  feedMissing: (url) => `${url} sürüm akışında henüz komut satırı paketi yok: bir sonraki sürümden sonra yeniden deneyin`,
  downloadFailed: (url, detail) => `${url} indirilemedi: ${detail}`,
  verifyFailed: (detail) => `İndirilen paket denetimlerden geçemedi ve yüklenmedi: ${detail}`,
  unsignedBuild:
    "Bu paket imzalı değil, bu yüzden bir güncellemenin imzasını denetleyemez. Bunun yerine bağımsız paketi BaoCut'ın sürümler sayfasından indirin",
  noPrevious: (dir) => `${dir} içinde geri dönülecek önceki bir sürüm yok`,
  inProgress: (pid) => `Başka bir baocut update (pid ${pid}) çalışıyor: bitmesini bekleyin`,
};
