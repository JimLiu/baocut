import type { TemplatesMessages } from './templates-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: TemplatesMessages = {
  help: `Uso:
  baocut templates                 Listar templates de criação disponíveis (integrados e em <BAOCUT_HOME>/templates),
                                   além das pastas de template que não foram carregadas e o motivo
  baocut templates show <id>       Mostrar os destaques do manifesto do template e o prompt.md completo`,
  kindLabels: { scene: 'Template de cena', example: 'Exemplo' }, originLabels: { builtin: 'Integrado', user: 'Usuário' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? 'proporção automática'} · ${seconds ? `${seconds} s` : 'duração automática'}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} template ${dir} (${code}): ${message}`,
  folder: (path: string) => `  Pasta: ${path}`, none: 'Nenhum template disponível',
  skipped: (n: number) => pluralForm('pt-BR', n, { one: `Ignorada ${n} pasta de template:`, other: `Ignoradas ${n} pastas de template:` }),
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) => `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Categoria: ${category}  Proporção e duração: ${spec}  Idioma: ${language}`,
  author: (author: string, source: string, license: string) => `Autor: ${author} (${source}, ${license})`, tags: (tags: readonly string[]) => `Tags: ${tags.join(', ')}`, sample: (sample: string) => `Tente dizer: ${sample}`, cover: (file: string) => `Capa: ${file}`, preview: (file: string) => `Prévia: ${file}`,
  asset: (path: string, type: string, note: string) => `Mídia: ${path} (${type})${note ? ` ${note}` : ''}`,
  verification: (v) => `Verificado: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, exportação ${v.output.ratio} · ${v.output.seconds} s` : ''}${v.missing.length ? `, ausente ${v.missing.join(', ')}` : ''}`,
  templateFlag: (value: string) => `--template recebe um id de template (kebab-case, veja baocut templates): ${value}`,
};
