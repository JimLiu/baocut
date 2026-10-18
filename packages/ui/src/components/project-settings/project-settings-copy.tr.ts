import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const tr: ProjectSettingsMessages = {
  menuItem: 'Proje ayarları…',
  title: 'Proje ayarları',
  close: 'Proje ayarlarını kapat',
  done: 'Tamamlandı',
  loading: 'git denetleniyor',
  loadFailed: (message: string) => `git denetlenemedi: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut, videolarınızın çalışma alanı anlık görüntülerini projenin bulunduğu git deposuna commit edebilir. Sürüm geçmişi git gerektirmez ve depo dışında da aynı şekilde çalışır.',
  branch: (name: string) => `Dal ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Yeniden denetle',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Hazır',
  lightPaused: (label: string) => `Duraklatıldı · ${label}`,
  lightNotRepo: 'git deposunda değil',
  lightUnavailable: 'git bulunamadı',
  lightError: 'git başarısız oldu',
  pauseLocked: 'Depo kullanımda',
  pauseMerge: 'Birleştirme sürüyor',
  pauseRebase: 'Rebase sürüyor',
  pauseCherryPick: 'Cherry-pick sürüyor',
  pauseRevert: 'Revert sürüyor',
  pauseBisect: 'Bisect sürüyor',
  pauseDetached: 'HEAD ayrık',
  pauseLocalConfig: 'Yerel filtreler',
  pauseLocalConfigChanged: 'Yerel filtreler değişti',

  pausedHeading: (label: string) => `Commit işlemleri duraklatıldı: ${label}`,
  pausedNote:
    'Commit işlemleri duraklatıldığında otomatik commit ve “git’e commit et” bekler. Açma, düzenleme ve sürüm geçmişi etkilenmez.',
  errorHeading: 'git başarısız oldu',
  unavailableHeading: 'git bulunamadı',

  lcEntry: 'Girdi',
  lcValue: 'Komut ya da dahil edilen dosya',
  lcExplain:
    'İzin verdikten sonra BaoCut, git’i çalıştırırken bu girdilere uyar (örneğin git-crypt şifrelemesi). İzin projeye değil, yalnızca bu bilgisayara kaydedilir; girdiler ya da dahil edilen dosyalar değişirse BaoCut yeniden duraklar. Bu, klasöre güvenmek anlamına gelmez: açma, düzenleme ve ajanlar etkilenmez.',
  lcWeb:
    'Bu girdiler yalnızca BaoCut masaüstü uygulamasının proje ayarlarında listelenir ve yalnızca orada izin verilebilir (ya da baocut projects git-allow ile). Commit işlemleri duraklatıldığında açma, düzenleme ve sürüm geçmişi etkilenmez.',
  allow: 'İzin Ver',
  allowedTitle: 'Yerel filtrelere izin verildi',
  allowedText: 'İzin projeye değil, bu bilgisayara kaydedildi. Artık commit edebilirsiniz.',
  allowFailed: 'İzin verilmedi',

  commit: 'git’e commit et',
  committing: 'Commit ediliyor',
  commitDesc: (maxMiB: number) =>
    `Yalnızca BaoCut’ın dosyalarını commit eder: değişen videoların çalışma alanı anlık görüntüleri ve ${maxMiB} MiB’a kadar medya. Projedeki diğer dosyalar ve önceden stage ettiğiniz değişiklikler olduğu gibi kalır. BaoCut push yapmaz.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Son commit ${commit} · ${auto ? 'otomatik' : 'elle'} · ${ago}`,
  lastFailed: (message: string) => `Son deneme başarısız oldu: ${message}`,
  committedTitle: 'git’e commit edildi',
  committedText: (commit: string, files: number, videos: string[]) =>
    `${commit} commit edildi: ${files} dosya${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `“${name}”` : from === to ? `“${name}” sürüm ${to}` : `“${name}” sürüm ${from}–${to}`,
  unnamedVideo: 'bir video',
  nothingTitle: 'Commit edilecek bir şey yok',
  nothingText: 'BaoCut’ın dosyaları son commit’tekiyle aynı.',
  commitFailed: 'Commit edilmedi',

  autoCommit: 'Otomatik commit',
  autoCommitDesc:
    'Projede 5 dakika değişiklik olmadığında, projenin açık kalan son videosunu kapattığınızda ya da BaoCut’tan çıktığınızda bir kez commit eder. Bu bilgisayardaki tüm projeler bu ayarı paylaşır.',

  initTitle: 'git’i başlat',
  initDesc: 'Anlık görüntüleri commit edebilmeniz için proje klasöründe bir git deposu oluşturun.',
  initWebNote:
    'Runtime’ın çalıştığı bilgisayardaki bir klasörde depo oluşturmak yalnızca BaoCut masaüstü uygulamasında ya da CLI’da (baocut projects git-init) yapılabilir.',
  initRefused: (why: string) => `Burada kullanılamaz: ${why}`,
  initRefusedNote: 'Gerekirse videoları kendilerine ait bir proje klasörüne taşıyın ve git’i orada başlatın.',
  refusalHome:
    'proje, ana klasörünüz. Burada bir depo olursa diğer araçlara ana klasörünüzdeki her klasör bu deponun parçası gibi görünür.',
  refusalUserFolder:
    'proje standart bir kullanıcı klasörü (Masaüstü, Belgeler, İndirilenler, Filmler, Müzik veya Resimler gibi). Burada bir depo olursa diğer araçlara içindeki her klasör bu deponun parçası gibi görünür.',
  refusalVolumeRoot: 'proje bir diskin kökü. Burada bir depo olursa diskin tamamı bu deponun parçası gibi görünür.',
  refusalInsideRepo: 'proje zaten bir git deposunda.',
  initConfirmTitle: 'Proje klasöründe git başlatılsın mı?',
  initConfirmBody: (path: string) =>
    `${path} içinde bir git deposu oluşturur. BaoCut’ın yok sayma kuralları deponun kendi .git/info/ klasörüne yazılır; bu yüzden projedeki hiçbir dosya değişmez. Hiçbir şey commit veya push edilmez.`,
  cancel: 'İptal',
  initDoneTitle: 'git başlatıldı',
  initDoneText: 'Henüz commit yok. İlk commit’i yapmak için “git’e commit et” düğmesini kullanın.',
  initFailed: 'Başlatılamadı',

  recheckSame: 'Hiçbir şey değişmedi',
  recheckReadyTitle: 'Commit için hazır',
  recheckReadyText: 'Depo artık duraklatılmış değil.',

  outsideHeading: 'Proje dışındaki medya',
  outsideLead:
    'Bir video proje klasörü dışındaki medyayı kullandığında, çalışma alanı anlık görüntüsü medyanın yolunu kaydeder (ana klasörünüzün altındaysa ~/ ile başlayan, değilse tam yol). Commit veya push yaptıktan sonra diğerleri dosyayı değil, yalnızca yolu alır. Medyayı da teslim etmek için taşınabilir paket kullanın.',

  stripLabel: 'Proje git’i',
  projectSettings: 'Proje ayarları',
};
