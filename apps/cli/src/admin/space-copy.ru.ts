import { pluralForm } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';

export const ru: SpaceMessages = {
  help: "Использование:\n  baocut space rescan              Снова сканировать папки источников\n  baocut space rebuild             Перестроить каталог Space из папок источников и записей;\n                                   индекс содержимого перечитывает все видео в фоне\n  baocut space trash|restore <entry id>\n                                   Переместить в корзину / восстановить (файлы не затрагиваются;\n                                   для записей видео папка видео перемещается в корзину или из неё)\n  baocut space purge <entry id>    Навсегда удалить запись из корзины; не удаляется, пока\n                                   используется видео или задачей, ссылки перечисляются\n  baocut space delete-video <entry id>\n                                   Удалить видео: папка видео перемещается в корзину, восстановление возможно\n                                   в период хранения; исходные файлы связанных материалов не затрагиваются\n  baocut space continue <entry id> [--conversation <session id>]\n                                   Продолжить сессию из записи: ссылка (только ID и метаданные) добавляется\n                                   к следующему сообщению; без сессии она выбирается по расположению записи или создаётся",
  usage: [
    "Использование: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>",
    "       baocut space continue <entry id> [--conversation <session id>]",
  ].join("\n"),
  entryUsage: (action) => `Использование: baocut space ${action} <entry id>`,
  continueUsage: "Использование: baocut space continue <entry id> [--conversation <session id>]",
  flagNotAccepted: (action, key) => `baocut space ${action} не принимает --${key}`,
  rescanStarted: "Повторное сканирование начато",
  rebuilt: (entries, pendingVideos) => `Каталог перестроен: ${pluralForm('ru', entries, { one: `${entries} запись`, few: `${entries} записи`, many: `${entries} записей`, other: `${entries} записи` })}; индекс содержимого перечитывает ${pluralForm('ru', pendingVideos, { one: `${pendingVideos} видео`, few: `${pendingVideos} видео`, many: `${pendingVideos} видео`, other: `${pendingVideos} видео` })} в фоне, до завершения результаты поиска неполны`,
  purgeBlocked: (id) => `${id} ещё используется видео или задачей; не удалено`,
  movedToTrash: (id, name) => `Перемещено в корзину: ${id}  ${name}`,
  restoredFromTrash: (id, name) => `Восстановлено из корзины: ${id}  ${name}`,
  purged: (id) => `Удалено навсегда: ${id}`,
  notPurged: (id) => `Не удалено: ${id}: ещё есть ссылки`,
  videoTrashed: (name, entryId, retentionDays) => `Видео «${name}» перемещено в корзину: ${entryId} (восстановите через baocut space restore ${entryId}${retentionDays === null ? '' : `; удалится навсегда через ${pluralForm('ru', retentionDays, { one: `${retentionDays} день`, few: `${retentionDays} дня`, many: `${retentionDays} дней`, other: `${retentionDays} дня` })}`})`,
  relatedKept: (n) => `${pluralForm('ru', n, { one: `${n} запись`, few: `${n} записи`, many: `${n} записей`, other: `${n} записи` })} после экспорта или генерации из видео остаются на прежнем месте`,
  continued: (created, id, cwd) => `${created ? "Создана сессия" : "Используется сессия"} ${id}  рабочая папка ${cwd}`,
  referenceNext: (name, id) => `Ссылка на запись «${name}» будет приложена к следующему сообщению: baocut chat "…" --conversation ${id}`,
};
