import { pluralForm } from '@baocut/protocol';
import type { TemplatesMessages } from './templates-copy.ts';

export const ru: TemplatesMessages = {
  help: "Использование:\n  baocut templates                 Список доступных шаблонов создания (встроенные и в <BAOCUT_HOME>/templates),\n                                   а также папки шаблонов, которые не загрузились, и причины\n  baocut templates show <id>       Показать основные поля манифеста шаблона и полный prompt.md",
  kindLabels: { scene: "Шаблон сцены", example: "Пример" },
  originLabels: { builtin: "Встроенный", user: "Пользовательский" },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? "автоматическое соотношение"} · ${seconds ? `${seconds} с` : "автоматическая длительность"}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} — шаблон ${dir} (${code}): ${message}`,
  folder: (path: string) => `  Папка: ${path}`,
  none: "Нет доступных шаблонов",
  skipped: (n: number) => pluralForm('ru', n, { one: `Пропущена ${n} папка шаблона:`, few: `Пропущены ${n} папки шаблонов:`, many: `Пропущено ${n} папок шаблонов:`, other: `Пропущено ${n} папки шаблонов:` }),
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) => `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Категория: ${category}  Соотношение сторон и длительность: ${spec}  Язык: ${language}`,
  author: (author: string, source: string, license: string) => `Автор: ${author} (${source}, ${license})`,
  tags: (tags: readonly string[]) => `Теги: ${tags.join(", ")}`,
  sample: (sample: string) => `Попробуйте сказать: ${sample}`,
  cover: (file: string) => `Обложка: ${file}`,
  preview: (file: string) => `Предпросмотр: ${file}`,
  asset: (path: string, type: string, note: string) => `Материал: ${path} (${type})${note ? ` ${note}` : ""}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) => `Проверено: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, экспорт ${v.output.ratio} · ${v.output.seconds} с` : ""}${v.missing.length ? `, отсутствует ${v.missing.join(", ")}` : ""}`,
  templateFlag: (value: string) => `--template принимает id шаблона (kebab-case, см. baocut templates): ${value}`,
};
