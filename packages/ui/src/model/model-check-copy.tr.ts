import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: 'Model çalışıyor ancak örnekteki konuşmayı tanıyamıyor',
  synthesize: 'Model çalışıyor ancak ürettiği ses doğru değil',
  image: 'Model çalışıyor ancak çizdiği görsel doğru değil',
  separate: 'Model çalışıyor ancak sesi arka plandan ayırmadı',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'BaoCut ile gelen dosya eksik; model sorunu değil',
    todo: 'BaoCut yeniden yüklemek çözer. İndirilen modeller etkilenmez.',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: 'Model dosyaları bozuk', todo: 'Onarım bozuk dosyaları yeniden indirir.' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: 'Önce onarın. Sürerse teknik ayrıntıları kopyalayıp bize gönderin.',
  }),
  MODEL_OUT_OF_MEMORY: () => ({ text: 'Bellek yetersiz; model yüklenemedi', todo: 'Diğer büyük modelleri veya çok bellek kullanan uygulamaları kapatıp yeniden denetleyin.' }),
  MODEL_WORKER_FAILED: () => ({
    text: 'Modeli çalıştıran arka plan süreci hata verdi',
    todo: 'Yeniden denetleyin. Sürerse BaoCut yeniden başlatın veya teknik ayrıntıları kopyalayıp bize gönderin.',
  }),
};

function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `Bellek yetersiz; ${verb} tamamlanamadı`, todo: noMemoryTodo },
    modelError: { text: `Model hata verdi; ${verb} çıktısı yok`, todo: 'Sorunu görmek için modeli denetleyin.' },
    other: (message) => ({ text: `${verb} başarısız: ${message}`, todo: 'Yeniden deneyebilirsiniz. Sürerse Arka plan görevleri kısmındaki ayrıntılara bakın.' }),
    notStarted: (message) => ({ text: `${verb} başlatılamadı: ${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo} Şimdi ${noun} büyük olasılıkla yine başarısız olur.`,
  };
}

export const tr: ModelCheckMessages = {
  label: {
    check: 'Denetle',
    checkFull: 'Modeli denetle',
    recheck: 'Yeniden denetle',
    repair: 'Onar…',
    repairSub: 'Yalnızca bozuk dosyaları yeniden indirir',
    details: 'Teknik ayrıntılar',
    hideDetails: 'Teknik ayrıntıları gizle',
    copy: 'Teknik ayrıntıları kopyala',
    copied: 'Teknik ayrıntılar kopyalandı',
    copyFailed: 'Kopyalanamadı. Yukarıdaki metni seçip kendiniz kopyalayın.',
    cancel: 'İptal',
    retry: 'Yeniden dene',
    pickRef: 'Başka kayıt seç…',
    useSample: 'Örnek kaydı kullan',
  },
  caption: 'Denetim modelin çalıştığını doğrular; onarım yalnızca bozuk dosyaları yeniden indirir. Silinirken diğer modellerin kullandığı ortak bileşenler korunur.',
  head: {
    running: 'Denetleniyor…',
    repairing: 'Onarılıyor…',
    failed: 'Denetim başarısız:',
    notStarted: 'Denetim başlatılamadı:',
  },
  sentence: (text) => `${text}.`,
  phase: {
    queued: 'Sırada',
    loading: 'Model yükleniyor',
    running: 'Kısa örnek çalıştırılıyor',
    verifying: 'Sonuç doğrulanıyor',
    repairing: 'Bozuk dosyalar yeniden indiriliyor; onarımdan sonra otomatik yeniden denetlenir',
  },
  checkSentences,
  unknown: {
    text: 'Model düzgün çalışmadı',
    todo: 'Yeniden denetleyin. Sürerse teknik ayrıntıları kopyalayıp bize gönderin.',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: 'BaoCut arka plan hizmeti yanıt vermiyor', todo: 'Daha sonra yeniden denetleyin. Sürerse BaoCut yeniden başlatın.' },
    MODEL_IN_USE: { text: 'Başka görev bu modeli kullanıyor', todo: 'Görevin bitmesini bekleyin veya Arka plan görevleri kısmında iptal edip yeniden denetleyin.' },
    MODEL_UNAVAILABLE: { text: 'Bu model şu anda kullanılamıyor', todo: 'Önce onarın veya yeniden açın, sonra denetleyin.' },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: 'Bu bilgisayarda modeli çalıştıracak bellek yetersiz', todo: 'Daha küçük modele geçin.' },
    WEB_METHOD_NOT_ALLOWED: { text: 'Tarayıcıda yerel modeller denetlenemez', todo: 'Masaüstü uygulamasında denetleyin.' },
    OFFLINE_STRICT: { text: 'Katı çevrimdışı mod açık', todo: 'Ayarlar kısmında katı çevrimdışı modu kapatıp yeniden denetleyin.' },
  },
  notStartedUnknown: {
    text: 'BaoCut bu denetimi kabul etmedi',
    todo: 'Daha sonra yeniden denetleyin. Sürerse teknik ayrıntıları kopyalayıp bize gönderin.',
  },
  detail: {
    code: (code) => `Kod ${code}`,
    model: (id, when) => `Model ${id} · ${when}`,
    message: (message) => `Mesaj ${message}`,
    passed: (when) => `Denetim geçti · ${when}`,
  },
  noticeText: (what) => `Bu model son denetimi geçemedi: ${what}`,
  refUnreadable: (file) => ({
    text: `“${file}” kaydınız okunamadı. Dosya bozuk veya ses değil`,
    todo: 'Başka kayıt deneyin veya önce örnek kaydı dinleyin.',
  }),
  refUnknown: 'kayıt',
  trySpeech: trySubject('sentez', 'önizleme', 'Diğer büyük modelleri veya çok bellek kullanan uygulamaları kapatıp yeniden deneyin.'),
  tryImage: trySubject('çizim', 'deneme çizimi', 'Diğer büyük modelleri kapatıp yeniden deneyin veya adım sayısını düşürün.'),
};
