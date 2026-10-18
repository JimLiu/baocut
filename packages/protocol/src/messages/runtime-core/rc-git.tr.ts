import type { RcGitMessages } from './rc-git.ts';

export const tr: RcGitMessages = {
  gitPurpose: "Bir projedeki BaoCut dosyalarını git'e commit eder (isteğe bağlı)",
  gitMissingRemedyMac: "git'i kurun: Command Line Tools için Terminal'de xcode-select --install komutunu çalıştırın ya da Homebrew ile kurun (brew install git)",
  gitMissingRemedyWin: "Git for Windows'u https://git-scm.com/download/win adresinden kurun",
  gitMissingRemedyLinux: "git'i paket yöneticinizle kurun",
  xcodeStub: '/usr/bin/git, Command Line Tools kurulana kadar yalnızca onları kurmayı önerir',

  notRepo: 'Bu proje bir git deposunda değil',
  initRemedy: 'Proje klasöründe baocut projects git-init komutunu çalıştırın ya da depoyu istediğiniz yerde git init komutunu kendiniz çalıştırın',
  initHome: 'BaoCut ana klasörünüzde git deposu oluşturmaz: diğer araçlara içindeki her klasör tek bir deponun parçası gibi görünürdü',
  initUserFolder: (p) =>
    `BaoCut standart bir kullanıcı klasöründe (${p.path}) git deposu oluşturmaz: diğer araçlara içindeki her klasör tek bir deponun parçası gibi görünürdü`,
  initVolumeRoot: 'BaoCut bir birimin ya da sürücünün kökünde git deposu oluşturmaz',
  initInsideRepo: 'Bu proje zaten bir git deposunda',
  initElsewhere: 'Önce projeyi kendi klasörüne taşıyın ya da depoyu istediğiniz yerde git init komutunu kendiniz çalıştırın',
  pausedLocked: 'Depo başka bir git komutu tarafından kullanılıyor (index.lock var)',
  lockedRemedy:
    'Diğer git komutunun bitmesini bekleyin. BaoCut bir sonraki commit sırasında yeniden dener ve kilit dosyasını asla silmez; çalışan bir git komutu yoksa kilidi kendiniz kaldırın',
  pausedMerge: 'Depoda bir birleştirme (merge) sürüyor',
  pausedRebase: 'Depoda bir rebase sürüyor',
  pausedCherryPick: 'Depoda bir cherry-pick sürüyor',
  pausedRevert: 'Depoda bir revert sürüyor',
  pausedBisect: 'Depoda bir bisect sürüyor',
  pausedDetached: 'HEAD ayrık durumda (depo hiçbir dalda değil)',
  repoStateRemedy: "Bunu git'te tamamlayın ya da iptal edin; ardından BaoCut yeniden commit eder",
  detachedRemedy: "git'te bir dala geçin; ardından BaoCut yeniden commit eder",
  pausedLocalConfig:
    'Deponun yerel yapılandırması programlar çalıştırıyor ya da başka dosyaları dahil ediyor (filtreler ya da include); bu yüzden BaoCut dosyalarınızı okuyan git komutlarını çalıştırmaz',
  pausedLocalConfigChanged: 'Deponun yerel filtreleri ya da include ayarları siz izin verdikten sonra değişti; bu yüzden BaoCut commit işlemlerini yeniden duraklattı',
  localConfigRemedy: 'Girdileri ve çalıştırdıkları komutları gözden geçirin, ardından baocut projects git-allow ile izin verin',
  gitFailed: (p) => `git bu depoda başarısız oldu: ${p.detail}`,

  manageOnlyInAppOrCli: "git'i başlatmak ya da yerel filtrelere izin vermek yalnızca masaüstü uygulamasında veya CLI'da yapılabilir",
  digestChanged: 'Yerel yapılandırma gözden geçirildikten sonra değişti; girdileri yeniden gözden geçirin',
  commitFailed: (p) => `git'e commit başarısız oldu: ${p.detail}`,
  initFailed: (p) => `git başlatılamadı: ${p.detail}`,

  commitSummary: (p) => `"${p.name}" projesindeki BaoCut dosyalarını git'e commit et`,
  commitTitle: (p) => `BaoCut: ${p.names} güncellemesi`,
};
