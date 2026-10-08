import type { TemplatesMessages } from './templates-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: TemplatesMessages = {
  help: `Uso:
  baocut templates                 Elenca i template di creazione disponibili (integrati e in <BAOCUT_HOME>/templates),
                                   oltre alle cartelle dei template non caricati e il motivo
  baocut templates show <id>       Mostra i punti principali del manifesto del template e tutto prompt.md`,
  kindLabels: { scene: 'Template di scena', example: 'Esempio' }, originLabels: { builtin: 'Integrato', user: 'Utente' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? 'rapporto automatico'} · ${seconds ? `${seconds} s` : 'durata automatica'}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} template ${dir} (${code}): ${message}`,
  folder: (path: string) => `  Cartella: ${path}`, none: 'Nessun template disponibile',
  skipped: (n: number) => pluralForm('it', n, { one: `${n} cartella di template saltata:`, other: `${n} cartelle di template saltate:` }),
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) => `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Categoria: ${category}  Rapporto e durata: ${spec}  Lingua: ${language}`,
  author: (author: string, source: string, license: string) => `Autore: ${author} (${source}, ${license})`, tags: (tags: readonly string[]) => `Tag: ${tags.join(', ')}`, sample: (sample: string) => `Prova a dire: ${sample}`, cover: (file: string) => `Copertina: ${file}`, preview: (file: string) => `Anteprima: ${file}`,
  asset: (path: string, type: string, note: string) => `Materiale: ${path} (${type})${note ? ` ${note}` : ''}`,
  verification: (v) => `Verificato: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, esportazione ${v.output.ratio} · ${v.output.seconds} s` : ''}${v.missing.length ? `, mancanti ${v.missing.join(', ')}` : ''}`,
  templateFlag: (value: string) => `--template accetta un id di template (kebab-case, vedi baocut templates): ${value}`,
};
