import type { OnboardingMessages } from './onboarding-copy.ts';

export const tr: OnboardingMessages = {
  dialogLabel: 'BaoCut’a hoş geldiniz',
  stepsLabel: 'Kurulum adımları',
  step: {
    agent: 'Ajan bağlayın',
    asr: 'Konuşma tanıma',
    tts: 'Konuşma sentezi',
    semantic: 'Anlamsal arama',
    image: 'Görsel oluşturma',
    music: 'Müzik oluşturma',
  },
  title: {
    agent: 'BaoCut’a hoş geldiniz',
    asr: 'Konuşma tanıma modellerini indirin',
    tts: 'Konuşma sentezi modellerini indirin',
    semantic: 'Anlamsal aramayı yükleyin',
    image: 'Görsel oluşturma modellerini indirin',
    music: 'Müzik oluşturma modellerini indirin',
  },
  lead: {
    agent:
      'İstediğiniz videoyu anlatın; Ajan sizin için yazıya döker, altyazı ekler, çevirir, seslendirir ve düzenler. BaoCut bu bilgisayardaki Ajanları (Claude Code veya Codex gibi) kendi hesabınızla kullanır; ek ücret yoktur.',
    asr: 'Yazıya dökme, altyazı ekleme ve konuşma videolarını kısaltma, konuşmayı metne çevirmekle başlar. Modeller bu bilgisayarda çalışır ve çevrimdışı da kullanılabilir.',
    tts: 'Konuşma sentezi modelleri metni sesli okur, bir kayıttan ses klonlar ve çevrilmiş videoları seslendirir. Başlamak için bir iki tane seçin; diğerlerini daha sonra Ayarlar › Konuşma sentezi bölümünden indirebilirsiniz.',
    semantic:
      'Söylenenleri ve gösterilenleri anlamına göre bulur: Space araması, konuya göre malzeme seçme, görüntü eşleştirme ve çeviri belleği bunu kullanır. Yüklendikten sonra mevcut videolarınız arka planda dizinlenir.',
    image: 'Bu bilgisayarda tek bir cümleden kapak ve illüstrasyonlar için görseller oluşturur. Modeller büyüktür ve oluşturma yavaştır.',
    music:
      'Bu bilgisayarda bir stilden veya şarkı sözlerinden arka plan müziği ve şarkılar oluşturur; bunları doğrudan bir videonun müzik parçasına ekleyebilirsiniz. Oluşturma yavaştır: 30 saniye için birkaç dakika kadar sürer.',
  },
  where: {
    tts: {
      title: 'Araçlar › Konuşma oluştur bölümünde kullanın',
      body: 'Bir metin yazın ya da Space’te bir belge veya altyazı seçin, ardından bir model ve ses seçin. İndirmediğiniz modelleri de oradan indirebilirsiniz.',
    },
    image: { title: 'Araçlar › Görsel oluştur bölümünde kullanın', body: 'Görseli tek cümleyle tarif edin. Ajanlar da kapak oluşturmak için bunu kullanır.' },
    music: {
      title: 'Araçlar › Müzik oluştur bölümünde kullanın',
      body: 'Bir stil seçin ve şarkı sözlerini yazın. Müzik Space’e kaydedilir ve videolarınıza eklenebilir.',
    },
  },
  diarizes: 'Yazıya dökerken konuşmacıları ayırt eder',
  needsDiarization: (pack) => `Konuşmacıları ayırt etmek için “${pack}” paketini de indirin`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 hazır ses · konuşma stilini tek cümleyle tarif edin',
    'qwen3-tts-0.6b-base': '3 saniyelik bir kayıttan ses klonlar',
    voxcpm2: 'Kayıttan ses klonlar · stil tarif edilebilir · 30 dil ve Kantonca',
    'qwen-image-2.1-turbo': 'Damıtılmış · sabit 8 adım · temel modelden iki kattan fazla hızlı',
    'qwen-image-2.1': 'Temel model · daha yavaş, daha çok adım',
    'yue2-3b': 'Stilden veya şarkı sözlerinden oluşturur · 30 saniye için birkaç dakika kadar',
  },
  recommended: 'Önerilen',
  installed: 'Yüklü',
  missingParts: 'Eksik bileşenler',
  planLine: (parts) => `Birlikte indirilir: ${parts}`,
  downloading: (name) => `${name} indiriliyor`,
  inBackground: 'Arka planda indiriliyor',
  bgNote: 'İndirmeden önce nereden geldiğini ve nereye kaydedileceğini görürsünüz. Yalnızca onayınızdan sonra başlar ve arka planda çalışır, beklemeniz gerekmez.',
  asrAlt: 'İndirmek istemiyor musunuz? Bulut konuşma tanımayı daha sonra Ayarlar › API sağlayıcıları bölümünden de ekleyebilirsiniz.',
  unsupported: 'Bu bilgisayar bu modelleri çalıştıramaz. Bu adımı atlayabilirsiniz.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Bu bilgisayardaki Ajanlar',
  agentChecking: 'Bu bilgisayardaki Ajanlar denetleniyor…',
  agentMissingBody: 'İstediklerinizi işaretleyin, BaoCut bunları arka planda yüklesin. Yüklendikten sonra mevcut hesabınızla bir kez oturum açın.',
  agentNote:
    'İşaretlenen Ajanlar yeni oturumların Ajan menüsünde görünür. Yükleme arka planda çalışır, beklemeniz gerekmez. Varsayılanı seçmek veya daha fazlasını eklemek için Ayarlar › Ajan sağlayıcıları bölümüne gidin.',
  agentInstalled: 'Bu bilgisayarda yüklü',
  agentFix: (problem) => `${problem} · Ayarlar › Ajan sağlayıcıları bölümünden düzeltin`,
  agentManual: 'Resmi talimatları izleyerek terminalde yükleyin · Bkz. Ayarlar › Ajan sağlayıcıları',
  agentNotInstalled: (plan) => (plan ? `Yüklü değil · Yükledikten sonra oturum açın: ${plan}` : 'Yüklü değil'),
  agentWillInstall: (method, command, login) =>
    `Arka planda ${method} ile yüklenecek (${command}) · Ardından oturum açmak için terminalde ${login} komutunu çalıştırın`,
  agentInstalling: (method, login) => `Arka planda ${method} ile yükleniyor · Ardından oturum açmak için terminalde ${login} komutunu çalıştırın`,
  agentInstallingLabel: (name) => `${name} yükleniyor`,
  agentInstallFailed: 'Yüklenemedi · Ayrıntılar Arka plan görevleri bölümünde',

  next: 'İleri',
  finish: 'Bitti',
  skip: 'Atla',
  exit: 'Kurulumdan çık',
  install: (n) => `Arka planda ${n} Ajan yükle ve devam et`,
  download: (size, last) => `Arka planda${size ? ` ${size}` : ''} indir ve ${last ? 'bitir' : 'devam et'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` %${pct}`;
      return kind === 'install' ? `${name} yükleniyor${tail}` : kind === 'download' ? `${name} indiriliyor${tail}` : `${name} hazırlanıyor${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `Arka planda ${n} öğe yükleniyor` : kind === 'download' ? `Arka planda ${n} öğe indiriliyor` : `Arka planda ${n} öğe hazırlanıyor`,
    idle: (kind) => (kind === 'install' ? 'Arka plan yüklemeleri' : kind === 'download' ? 'Arka plan indirmeleri' : 'Arka plan indirme ve yüklemeleri'),
    done: (kind, n) => (kind === 'install' ? `${n} yüklendi` : kind === 'download' ? `${n} indirildi` : `${n} tamamlandı`),
    failed: (kind, n) => (kind === 'install' ? `${n} yüklenemedi` : kind === 'download' ? `${n} indirilemedi` : `${n} tamamlanamadı`),
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`${models} model indiriliyor`] : []), ...(agents ? [`${agents} Ajan yükleniyor`] : [])];
    return `Arka planda ${parts.join(' ve ')}. ${models + agents === 1 ? 'Bittiğinde kullanıma hazır olur.' : 'Bittiklerinde kullanıma hazır olurlar.'}`;
  },
  viewTasks: 'Arka plan görevlerini görüntüle',
};
