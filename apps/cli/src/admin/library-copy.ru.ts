import { pluralForm } from '@baocut/protocol';
import type { LibraryMessages } from './library-copy.ts';

export const ru: LibraryMessages = {
  help: "Использование:\n  baocut library import <file>     Импортировать обменный файл; тип определяется по содержимому, не расширению:\n                                   глоссарии Markdown, голоса .bcvoice, цвета и стили субтитров бренд-кита JSON,\n                                   стикеры Lottie, изображения, видео, шрифты\n  baocut library export <library> <id> <path>\n                                   Экспортировать текущую версию: глоссарии Markdown, голоса .bcvoice,\n                                   материалы бренда исходным файлом; существующая цель не перезаписывается\n  baocut library remove <library> <id>\n                                   Удалить запись (содержимое, скопированное в видео, не затрагивается)\n  baocut library voice-clone <voice id> --provider <id> [--name <name>]\n                                   Отправить эталонную запись поставщику для создания клона (пока только elevenlabs):\n                                   требуется заявление о согласии и разрешение передачи данных с \"audio\"\n                                   (baocut grants create); выполняется как задача, Ctrl-C отменяет\n  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]\n                                   Удалить клон: сначала запросить удаление у поставщика, затем очистить запись\n                                   при успехе; --local-only очищает только локальную запись\n  baocut library video-selection <video id> [options]\n                                   Включённые в видео элементы библиотеки (в видео, можно отменить): без параметров\n                                   отображаются; указанные части заменяются полностью, остальные сохраняются.\n                                   Новые видео включают глоссарии с отметкой «по умолчанию включено»\n    --transcribe-glossaries <id,…> Глоссарии расшифровки (если при расшифровке не указан свой);\n                                   пустая строка очищает\n    --translate-glossaries <id,…>  Глоссарии перевода (для translate и перевода dub);\n                                   пустая строка очищает\n    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]\n                                   Голос говорящего (можно повторять, полная замена):\n                                   library:<id> или ID голоса поставщика (с @Provider)\n    --clear-speaker-voices         Очистить голоса говорящих",
  importUsage: "Использование: baocut library import <file>",
  exportUsage: "Использование: baocut library export <glossaries|voices|brand> <id> <path>",
  removeUsage: "Использование: baocut library remove <glossaries|voices|brand> <id>",
  voiceCloneUsage: "Использование: baocut library voice-clone <voice id> --provider <id> [--name <name>]",
  voiceCloneRemoveUsage: "Использование: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]",
  videoSelectionUsage: "Использование: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…",
  imported: (label, id, name) => `Импортировано в ${label}: ${id}  ${name}`,
  exported: (id, version, file, bytes) => `Экспортировано ${id} версия ${version} в ${file} (${pluralForm('ru', bytes, { one: `${bytes} байт`, few: `${bytes} байта`, many: `${bytes} байтов`, other: `${bytes} байта` })})`,
  deleted: (id) => `Удалено: ${id}`,
  remoteCloneOutcome: { deleted: "удалено удалённо", 'not-found': "голоса уже не было удалённо", skipped: "удалённый сервис не вызван" },
  voiceCloneRemoved: (id, provider, remote) => `Удалён клон голоса ${id} у поставщика ${provider} (${remote})`,
  libraryLabels: { glossaries: "Глоссарий", voices: "Голос", brand: "Бренд-кит" },
  unknownLibrary: (text) => `Нет такой библиотеки: ${text ?? '(missing)'}. Доступны: glossaries, voices, brand`,
  speakerVoiceFormat: (text) => `--speaker-voice принимает <transcript id>:<speaker>=<voice>[@<Provider>]; получено ${text}`,
  listSep: ", ",
  none: "(нет)",
  selectionHead: (videoId, documentId, revision) => `Видео ${videoId}${documentId ? ` (документ library-selection ${documentId} версия ${revision})` : " (ещё ничего не включено)"}`,
  transcribeGlossaries: (list) => `Глоссарии расшифровки: ${list}`,
  translateGlossaries: (list) => `Глоссарии перевода: ${list}`,
  speakerVoicesNone: "Голоса говорящих: (нет)",
  speakerVoice: (documentId, speakerId, voice, providerId) => `Голос говорящего: ${documentId}:${speakerId} = ${voice}${providerId ? ` (только у поставщика ${providerId})` : ""}`,
};
