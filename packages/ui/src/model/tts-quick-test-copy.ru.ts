import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const ru: TtsQuickTestMessages = {
  kindIntro: "Вступление",
  kindNumbers: "Числа",
  kindMood: "Тон",

  presetSub: {
    Vivian: "Женский · Яркий",
    Serena: "Женский · Спокойный",
    Uncle_Fu: "Мужской · Глубокий",
    Dylan: "Мужской · Молодой",
    Eric: "Мужской · Дикторский",
    Ryan: "Мужской · Бодрый",
    Aiden: "Мужской · Повествовательный",
    Ono_Anna: "Женский · Японский",
    Sohee: "Женский · Корейский",
  },

  builtinVoice: {
    'zh-female': "Китайский женский",
    'zh-male': "Китайский мужской",
    'en-female': "Английский женский",
    'en-male': "Английский мужской",
    'ja-female': "Японский женский",
    'ja-male': "Японский мужской",
    'es-female': "Испанский женский",
    'es-male': "Испанский мужской",
  },
  builtinCredit: "Корпус FLEURS (CC BY 4.0) и CMU ARCTIC · обрезано и нормализовано по громкости · исходные уведомления сохранены",

  describeWarm: "Тёплый женский",
  describeWarmText: "Тёплый дружелюбный голос взрослой женщины в умеренном темпе, как в разговоре с другом",
  describeAnchor: "Ровный мужской",
  describeAnchorText: "Ровный чёткий голос взрослого мужчины с дикторским тоном и равномерным ритмом",
  describeBright: "Яркий молодой",
  describeBrightText: "Яркий живой молодой голос с непринуждённым тоном",

  toneUpbeat: "Бодрый",
  toneUpbeatText: "Говорите ярко и бодро, чуть быстрее обычного",
  toneNatural: "Естественный",
  toneAnchor: "Ровный",
  toneAnchorText: "Говорите ровным чётким дикторским голосом в равномерном темпе",
  toneSoft: "Мягкий",
  toneSoftText: "Говорите мягко и медленнее, как в близком разговоре",

  customDescribe: "Описать свой",
  defaultVoice: "Голос по умолчанию",
  myVoices: "Мои голоса",
  fileVoice: "Использовать запись один раз",
  seconds: (n: string) => `${n} с`,

  textRequired: "Сначала введите текст для синтеза",
  textTooLong: (max: number) => `До ${max} символов за раз; для предпросмотра используйте короткую фразу`,
  describeRequired: "Сначала опишите желаемый голос одним предложением",
  myVoiceGone: "Этого голоса больше нет в «Мои голоса»; выберите другой",
  referenceRequired: "Сначала выберите эталонную запись или вернитесь к встроенному голосу",

  phaseSubmitting: "Отправка",
  phaseQueued: "В очереди",
  phaseLoading: "Загрузка модели",
  phaseGeneratingStep: (step: number, total: number) => `Генерация аудио · шаг ${step}/${total}`,
  phaseGenerating: "Генерация аудио",
  phaseWriting: "Запись аудио",
  phasePreparing: "Подготовка",

  sampleVoice: (name: string) => `Образец · ${name}`,
  customText: "Свой текст",
  elapsed: (seconds: string) => `Заняло ${seconds} с`,
  audioLength: (seconds: string) => `Аудио ${seconds} с`,
};
