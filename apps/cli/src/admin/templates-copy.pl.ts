import { pluralForm } from '@baocut/protocol';
import type { TemplatesMessages } from './templates-copy.ts';

export const pl: TemplatesMessages = {
  help: "Użycie:\n  baocut templates                 Lista dostępnych szablonów tworzenia (wbudowane i w <BAOCUT_HOME>/templates),\n                                   oraz foldery szablonów, których nie wczytano, i przyczyny\n  baocut templates show <id>       Pokaż najważniejsze pola manifestu szablonu i pełny prompt.md",
  kindLabels: { scene: "Szablon sceny", example: "Przykład" },
  originLabels: { builtin: "Wbudowany", user: "Użytkownika" },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? "automatyczne proporcje"} · ${seconds ? `${seconds} s` : "automatyczna długość"}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} – szablon ${dir} (${code}): ${message}`,
  folder: (path: string) => `  Folder: ${path}`,
  none: "Brak dostępnych szablonów",
  skipped: (n: number) => pluralForm('pl', n, { one: `Pominięto ${n} folder szablonu:`, few: `Pominięto ${n} foldery szablonów:`, many: `Pominięto ${n} folderów szablonów:`, other: `Pominięto ${n} folderu szablonów:` }),
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) => `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Kategoria: ${category}  Proporcje i długość: ${spec}  Język: ${language}`,
  author: (author: string, source: string, license: string) => `Autor: ${author} (${source}, ${license})`,
  tags: (tags: readonly string[]) => `Tagi: ${tags.join(", ")}`,
  sample: (sample: string) => `Spróbuj powiedzieć: ${sample}`,
  cover: (file: string) => `Okładka: ${file}`,
  preview: (file: string) => `Podgląd: ${file}`,
  asset: (path: string, type: string, note: string) => `Materiał: ${path} (${type})${note ? ` ${note}` : ""}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) => `Zweryfikowano: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, eksport ${v.output.ratio} · ${v.output.seconds} s` : ""}${v.missing.length ? `, brakuje ${v.missing.join(", ")}` : ""}`,
  templateFlag: (value: string) => `--template przyjmuje id szablonu (kebab-case, zobacz baocut templates): ${value}`,
};
