import { defineMessages, type TemplateSummary } from '@baocut/protocol';
import { zhHans } from './templates-copy.zh-Hans.ts';
import { zhHant } from './templates-copy.zh-Hant.ts';
import { ja } from './templates-copy.ja.ts';
import { ko } from './templates-copy.ko.ts';
import { es } from './templates-copy.es.ts';
import { fr } from './templates-copy.fr.ts';
import { de } from './templates-copy.de.ts';
import { nl } from './templates-copy.nl.ts';
import { ptBR } from './templates-copy.pt-BR.ts';
import { it } from './templates-copy.it.ts';
import { ru } from './templates-copy.ru.ts';
import { pl } from './templates-copy.pl.ts';
import { tr } from './templates-copy.tr.ts';
import { vi } from './templates-copy.vi.ts';

/** `baocut templates` 的文案（英文是键与类型的来源，译文在 `templates-copy.<语言>.ts`）。 */
const en = {
  /** `baocut templates --help` 的正文。 */
  help: `Usage:
  baocut templates                 List available creation templates (built-in and in <BAOCUT_HOME>/templates),
                                   plus template folders that failed to load and why
  baocut templates show <id>       Show a template's manifest highlights and the full prompt.md`,
  kindLabels: { scene: 'Scene template', example: 'Example' } satisfies Record<TemplateSummary['manifest']['kind'], string>,
  originLabels: { builtin: 'Built-in', user: 'User' } satisfies Record<TemplateSummary['origin'], string>,
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? 'auto ratio'} · ${seconds ? `${seconds} s` : 'auto length'}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} template ${dir} (${code}): ${message}`,
  folder: (path: string) => `  Folder: ${path}`,
  none: 'No templates available',
  skipped: (n: number) => `Skipped ${n} template ${n === 1 ? 'folder' : 'folders'}:`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) =>
    `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Category: ${category}  Ratio and length: ${spec}  Language: ${language}`,
  author: (author: string, source: string, license: string) => `Author: ${author} (${source}, ${license})`,
  tags: (tags: readonly string[]) => `Tags: ${tags.join(', ')}`,
  sample: (sample: string) => `Try saying: ${sample}`,
  cover: (file: string) => `Cover: ${file}`,
  preview: (file: string) => `Preview: ${file}`,
  asset: (path: string, type: string, note: string) => `Asset: ${path} (${type})${note ? ` ${note}` : ''}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `Verified: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, export ${v.output.ratio} · ${v.output.seconds} s` : ''}${v.missing.length ? `, missing ${v.missing.join(', ')}` : ''}`,
  templateFlag: (value: string) => `--template takes a template id (kebab-case, see baocut templates): ${value}`,
};

export type TemplatesMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
