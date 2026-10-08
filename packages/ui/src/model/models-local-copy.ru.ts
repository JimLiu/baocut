import type { ModelsLocalMessages } from './models-local-copy.ts';

export const ru: ModelsLocalMessages = {
  reason: {
    unsupported: "Не поддерживается на этом компьютере",
    resource: "Отключено",
    'worker-missing': "Отсутствует Model Worker",
    'missing-manifest': "Отсутствует манифест",
    'missing-file': "Отсутствуют файлы",
    'size-mismatch': "Несовпадение размера файла",
    'hash-mismatch': "Несовпадение контрольной суммы",
    incomplete: "Отсутствуют компоненты",
    'load-failed': "Не удалось загрузить",
    relocating: "Перемещение",
  },
  chipDefault: "По умолчанию",
  chipLoading: "Загрузка",
  chipReady: "Загружено",
  chipBusy: "Выполняется",
  chipUnloading: "Выгрузка",
  chipUnavailable: "Недоступно",
  capability: {
    transcribe: "Расшифровать",
    align: "Выравнивание",
    synthesize: "Синтезировать",
    image: "Изображение",
    separate: "Разделение",
    diarize: "Разделение говорящих",
  },
  auto: "Автоматически",
  notInstalled: (name) => `${name} (не установлено)`,
  componentName: { aligner: "Принудительное выравнивание", speaker: "Эмбеддинг говорящего", vad: "VAD (обнаружение голосовой активности)" },
  weights: "Веса модели",
};
