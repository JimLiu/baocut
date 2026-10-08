import { pluralForm } from '../../i18n.ts';
import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  const labels: Record<string, string> = { subtitles: 'субтитры', transcript: 'расшифровка', audio: 'аудио', video: 'видеофайл', portable: 'переносимый пакет', project: 'файл проекта' };
  return labels[kind] ?? kind;
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, язык ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, создать видео${p.name ? ` «${p.name}»` : ' (имя по заголовку страницы)'} и добавить на таймлайн${p.transcribe ? `, затем расшифровать${recognition}${p.captions ? ' и создать слой субтитров' : ''}` : ''}`;
  if (p.target === 'video') return `, импортировать в видео${p.transcribe ? ' и расшифровать' : ''}`;
  if (p.target === 'project') return `, сохранить в downloads/ проекта${p.transcribe ? ' и расшифровать в TXT и SRT' : ''}`;
  if (p.target === 'download') return `, сохранить в папку «Загрузки»${p.transcribe ? ' и расшифровать в TXT и SRT' : ''}`;
  return '';
}

export const ru: RcAgentToolsMessages = {
  instructionsNotSet: "Инструкции сессии не заданы: неверный порядок сборки Runtime",

  listSeparator: ", ",
  clauseSeparator: "; ",

  createVideoSummary: (p) => `Создать видео «${p.name}"`,
  editsSummary: (p) => `${p.label} (${pluralForm('ru', p.count, { one: `${p.count} операция`, few: `${p.count} операции`, many: `${p.count} операций`, other: `${p.count} операции` })}: ${p.types})`,
  captionsSummary: (p) => `Добавить: ${p.bilingual ? "двуязычный " : ""}слой субтитров документа ${p.documentId}`,
  captionsLabel: "Добавить слой субтитров",
  undoSummary: (p) => `Отменить правку ${p.transactionId}`,
  undoLatestSummary: "Отменить последнюю правку",
  deleteVideoSummary: (p) => `Удалить видео «${p.name}" (${p.path}): переместить в корзину, откуда можно восстановить в Space в течение ${pluralForm('ru', p.days, { one: `${p.days} день`, few: `${p.days} дня`, many: `${p.days} дней`, other: `${p.days} дня` })}. Исходные файлы связанных материалов остаются на месте`,
  importPackageSummary: (p) => `Открыть переносимый пакет ${p.file}`,
  renameVideoLabel: "Переименовать видео",
  putDocumentSummary: (p) => `Записать новую версию документа ${p.documentId}`,
  newDocumentSummary: (p) => `Создать документ (${p.kind})`,
  updateDocumentLabel: (p) => `Обновить документ «${p.name}"`,
  newDocumentLabel: (p) => `Создать документ «${p.name}"`,
  translationDocumentName: (p) => `${p.language} — перевод`,
  importAssetSummary: (p) => `Импортировать материал ${p.name}${p.place ? " и добавить на таймлайн" : ""}`,
  importAssetLabel: (p) => `Импортировать ${p.name}${p.place ? " и добавить на таймлайн" : ""}`,
  replaceCompositionSummary: (p) => `Импортировать ${p.name} и заменить им клип ${p.clip} на таймлайне`,
  replaceCompositionLabel: (p) => `Заменить анимированную графику на ${p.name}`,
  pruneAssetsSummary: (p) => `Удалить из видео неиспользуемые материалы (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Удалить неиспользуемые материалы (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Взять главы из источника ${p.asset} (${p.count})${p.existing ? `, заменив текущие главы (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Взять главы из источника',

  transcribePurpose: (p) => `Расшифровать материал ${p.assetId}`,
  transcribeSummary: (p) => `Расшифровать материал ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ""})` : ""}`,
  speechPurpose: (p) => `Синтезировать речь (${pluralForm('ru', p.chars, { one: `${p.chars} символ`, few: `${p.chars} символа`, many: `${p.chars} символов`, other: `${p.chars} символа` })})`,
  speechSummary: (p) => `Синтезировать речь (${pluralForm('ru', p.chars, { one: `${p.chars} символ`, few: `${p.chars} символа`, many: `${p.chars} символов`, other: `${p.chars} символа` })}${p.provider ? `, ${p.provider}` : ""}${p.voice ? `, голос ${p.voice}` : ""})`,
  imagePurpose: (p) => `Сгенерировать изображение: ${p.prompt}`,
  imageSummary: (p) => `Сгенерировать ${pluralForm('ru', p.count, { one: `${p.count} изображение`, few: `${p.count} изображения`, many: `${p.count} изображений`, other: `${p.count} изображения` })}${p.size ? `, ${p.size}` : ""}${p.provider ? `, ${p.provider}` : ""}: ${p.prompt}`,
  cancelJobSummary: (p) => `Отменить задачу ${p.jobId}`,
  retryPipelineSummary: (p) => `Повторить пайплайн ${p.jobId} (${p.pipeline}, попытка ${p.attempt}) с неудачного шага`,
  saveArtifactSummary: (p) => `Сохранить результат ${p.artifactId} как ${p.path}`,
  overwriteArtifactSummary: (p) => `Перезаписать существующий файл ${p.path} результатом ${p.artifactId}`,

  exportSummary: (p) => {
    const range =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}с` : p.rangeCount !== null ? `, ${pluralForm('ru', p.rangeCount, { one: `${p.rangeCount} диапазон`, few: `${p.rangeCount} диапазона`, many: `${p.rangeCount} диапазонов`, other: `${p.rangeCount} диапазона` })}` : "";
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, ширина ${p.width}`
          : p.height !== null
            ? `, высота ${p.height}`
            : "";
    const source = p.originalOnly ? ", только исходное аудио" : p.dubGroupId ? `, озвучка ${p.dubGroupId} — только` : "";
    return `Экспортировать ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` как ${p.fileName}` : ""}${p.overwrite ? ", перезаписав существующий файл" : ""}`;
  },

  installToolSummary: (p) => `Установить ${p.tool} ${p.version} (${p.estimated ? `около ${p.size}` : p.size}, ${p.license}) из ${p.url} для скачивания видео по ссылкам; скачивание из ${p.host} требует его`,
  linkImportSummary: (p) => `Скачать из ${p.host} через ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) => `Разрешить BaoCut использовать ${p.tool}${p.version ? ` ${p.version}` : ""} на этом компьютере${p.path ? ` (${p.path})` : ""} для скачивания видео с сайтов и скачать из ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p) => `Скопировать ${p.source} (${p.size}) из рабочей папки в «Загрузки»: ${p.target} (с номером при совпадении имени, без перезаписи)`,

  grantSummary: (p) => `Передать данные в ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p) => `${p.purpose} (${p.maxCalls === null ? "без лимита вызовов" : `до ${pluralForm('ru', p.maxCalls, { one: `${p.maxCalls} вызов`, few: `${p.maxCalls} вызова`, many: `${p.maxCalls} вызовов`, other: `${p.maxCalls} вызова` })}`})`,

  testModelSummary: (p) => `Проверить локальный пакет модели ${p.bundleId}: выполнить полностью на фиксированном образце`,
  installModelSummary: (p) => `Скачать локальную модель ${p.bundleId}: ${p.estimated ? `около ${p.size} (размер неизвестен, оценка)` : p.size}${p.resumed ? `, продолжая ${p.resumed} уже скачано` : ""}, из ${p.source} (${p.parts})`,

  registerProjectSummary: (p) => `Зарегистрировать существующую папку ${p.path} как проект${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p) => `Создать папку проекта ${p.path}${p.name ? ` (${p.name})` : ""}`,
  adoptSessionSummary: (p) => `Создать проект ${p.name ? `«${p.name}»` : 'с названием первого видео'} и перенести в него видео и файлы этой сессии`,
};
