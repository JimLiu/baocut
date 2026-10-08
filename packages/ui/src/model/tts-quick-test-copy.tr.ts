import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const tr: TtsQuickTestMessages = {
  kindIntro: 'Giriş',
  kindNumbers: 'Sayılar',
  kindMood: 'Ton',

  presetSub: {
    Vivian: 'Kadın · Parlak',
    Serena: 'Kadın · Sakin',
    Uncle_Fu: 'Erkek · Kalın',
    Dylan: 'Erkek · Genç',
    Eric: 'Erkek · Spiker',
    Ryan: 'Erkek · Enerjik',
    Aiden: 'Erkek · Anlatıcı',
    Ono_Anna: 'Kadın · Japonca',
    Sohee: 'Kadın · Korece',
  },

  builtinVoice: {
    'zh-female': 'Çince kadın',
    'zh-male': 'Çince erkek',
    'en-female': 'İngilizce kadın',
    'en-male': 'İngilizce erkek',
    'ja-female': 'Japonca kadın',
    'ja-male': 'Japonca erkek',
    'es-female': 'İspanyolca kadın',
    'es-male': 'İspanyolca erkek',
  },
  builtinCredit: 'FLEURS derlemi (CC BY 4.0) ve CMU ARCTIC · kısaltıldı ve ses yüksekliği normalleştirildi · özgün bildirimler korundu',

  describeWarm: 'Sıcak kadın sesi',
  describeWarmText: 'Bir arkadaşla sohbet eder gibi, orta tempolu, sıcak ve samimi yetişkin kadın sesi',
  describeAnchor: 'Dengeli erkek sesi',
  describeAnchorText: 'Spiker tonunda, düzenli ritimli, dengeli ve net yetişkin erkek sesi',
  describeBright: 'Canlı genç sesi',
  describeBrightText: 'Rahat tonlu, parlak ve canlı genç ses',

  toneUpbeat: 'Enerjik',
  toneUpbeatText: 'Parlak ve enerjik bir tonla, normalden biraz hızlı konuş',
  toneNatural: 'Doğal',
  toneAnchor: 'Dengeli',
  toneAnchorText: 'Düzenli tempoda, dengeli ve net spiker sesiyle konuş',
  toneSoft: 'Yumuşak',
  toneSoftText: 'Yakından konuşur gibi yumuşak ve daha yavaş konuş',

  customDescribe: 'Kendi sesimi tarif et',
  defaultVoice: 'Varsayılan ses',
  myVoices: 'Seslerim',
  fileVoice: 'Bir klipi bir kez kullan',
  seconds: (n: string) => `${n} sn`,

  textRequired: 'Önce sentezlenecek metni girin',
  textTooLong: (max: number) => `Bir seferde en fazla ${max} karakter; önizleme için daha kısa bir cümle kullanın`,
  describeRequired: 'Önce istediğiniz sesi bir cümleyle tarif edin',
  myVoiceGone: 'Bu ses artık Seslerim kısmında yok; başka birini seçin',
  referenceRequired: 'Önce bir referans kayıt seçin veya yerleşik sese dönün',

  phaseSubmitting: 'Gönderiliyor',
  phaseQueued: 'Sırada',
  phaseLoading: 'Model yükleniyor',
  phaseGeneratingStep: (step: number, total: number) => `Ses oluşturuluyor · adım ${step}/${total}`,
  phaseGenerating: 'Ses oluşturuluyor',
  phaseWriting: 'Ses yazılıyor',
  phasePreparing: 'Hazırlanıyor',

  sampleVoice: (name: string) => `Örnek · ${name}`,
  customText: 'Özel metin',
  elapsed: (seconds: string) => `${seconds} sn sürdü`,
  audioLength: (seconds: string) => `Ses ${seconds} sn`,
};
