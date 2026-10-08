import { pluralForm } from '@baocut/protocol';
const SOURCE = "«Источник скачивания моделей» в Настройки › Общие";
const and = (items: readonly string[]) => new Intl.ListFormat('ru', { type: 'conjunction' }).format(items);
const files = (n: number) => pluralForm('ru', n, { one: `${n} файл`, few: `${n} файла`, many: `${n} файлов`, other: `${n} файла` });
import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = 'Скачанная часть сохраняется; следующее скачивание продолжится с места остановки.';

export const ru: ModelsInstallMessages = {
  planSize: (size) => `Скачивает ${size}`,
  planSizeEstimate: (size) => `О видео ${size} (часть размеров файлов неизвестна, используется зарегистрированная оценка)`,
  amountEstimate: (size) => `О видео ${size}`,
  noSpace: (need, have) => `Недостаточно места на диске: требуется ${need}, на диске с папкой моделей только ${have}. Освободите место перед скачиванием.`,
  resumed: (size) => `Компонент ${size}, скачанное ранее, используется повторно без скачивания.`,
  space: (size) => `${size} свободно на диске`,
  lineKeep: "Уже установлено, без изменений",
  lineSize: (size, count) => `${size} · ${files(count)}`,
  lineUnknown: (count) => `Размер неизвестен · ${files(count)}`,
  queued: "В очереди на скачивание",
  downloading: (amount) => `Скачивание ${amount}`,
  downloadingUnknown: (amount) => `Скачивание · ${amount} получено`,
  verifying: "Проверка и публикация",
  pausedKept: (amount) => `Приостановлено · ${amount} сохранено; продолжение с места остановки`,
  paused: "Приостановлено",
  remedyNoSpace: (need, have) => `${need !== null && have !== null ? `Требуется ${need}, доступно только ${have}. ` : ""}Освободите место на диске и скачайте снова. ${KEEP}`,
  remedyNetwork: `Проверьте сеть и скачайте снова. ${KEEP} Если источник по умолчанию недоступен, смените зеркало в ${SOURCE}.`,
  remedyIntegrity: `Файлы источника скачивания не совпали с размером или sha256 манифеста и удалены. Смените источник скачивания (${SOURCE}), затем скачайте снова.`,
  remedySource: `В источнике скачивания нет файла или доступ запрещён. Проверьте полноту зеркала в ${SOURCE} (или переменной окружения BAOCUT_MODELS_ENDPOINT).`,
  remedyManifest: "Во встроенном манифесте пакета модели нет доверенного sha256, установка невозможна до обновления BaoCut.",
  remedyOffline: "Включён строгий офлайн-режим, скачивание отключено. Для скачивания сначала отключите режим в настройках.",
  remedySizeChanged: "Размер скачивания изменился. Подтвердите новый план снова.",
  remedyInUse: "Задача использует пакет модели (расшифровка, синтез, проверка или установка). Дождитесь завершения или отмените в «Фоновые задачи», затем удалите снова.",
  remedyUnavailable: "Пакет модели сейчас недоступен (не полностью установлен, отключён или не поддерживается компьютером). Сначала восстановите или включите.",
  remedyInstallFailed: `Попробуйте скачать снова. ${KEEP}`,
  problemText: (message, remedy) => (/[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`),
  removalBody: (unknown, frees, kept) => [
      unknown ? "Удаляет файлы, используемые только этим пакетом модели." : frees !== null ? `Освобождает около ${frees}.` : null,
      ...kept.map((k) => `${k.repo} сохраняется, поскольку ${and(k.usedBy)} ещё ${k.usedBy.length === 1 ? "использует" : "используют"} его.`),
      "Для повторного использования нужно скачать снова.",
    ]
      .filter(Boolean)
      .join(" "),
  removed: (bundleId) => `Удалено: ${bundleId}`,
  removedKept: (bundleId, repos) => `Удалено: ${bundleId} · ${and(repos)} сохранено, поскольку другие пакеты моделей ещё используют ${repos.length === 1 ? "это" : "их"}`,
};
