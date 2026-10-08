import {  type TemplateSummary } from '@baocut/protocol';
import { pluralForm } from '@baocut/protocol';
import type { TemplatesMessages } from './templates-copy.ts';

export const fr: TemplatesMessages = {

  help: `Utilisation :
  baocut templates                 Lister les modèles de création (intégrés et dans <BAOCUT_HOME>/templates),
                                   ainsi que les dossiers non chargés et les raisons
  baocut templates show <id>       Afficher les points clés du manifeste et le prompt.md complet`,
  kindLabels: { scene: "Modèle de scène", example: "Exemple" } satisfies Record<TemplateSummary['manifest']['kind'], string>,
  originLabels: { builtin: "Intégré", user: "Utilisateur" } satisfies Record<TemplateSummary['origin'], string>,
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? "format automatique"} · ${seconds ? `${seconds} s` : "durée automatique"}`,
  summaryLine: (title: string, summary: string) => `${title} : ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} modèle ${dir} (${code}) : ${message}`,
  folder: (path: string) => `  Dossier : ${path}`,
  none: "Aucun modèle disponible",
  skipped: (n: number) => `${n} ${pluralForm('fr', n, { one: "dossier de modèle ignoré", other: "dossiers de modèles ignorés" })} :`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) =>
    `${title} (${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `Catégorie : ${category}  Format et durée : ${spec}  Langue : ${language}`,
  author: (author: string, source: string, license: string) => `Auteur : ${author} (${source}, ${license})`,
  tags: (tags: readonly string[]) => `Tags : ${tags.join(", ")}`,
  sample: (sample: string) => `Essayez de dire : ${sample}`,
  cover: (file: string) => `Couverture : ${file}`,
  preview: (file: string) => `Aperçu : ${file}`,
  asset: (path: string, type: string, note: string) => `Média : ${path} (${type})${note ? ` ${note}` : ""}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `Vérifié : ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, export ${v.output.ratio} · ${v.output.seconds} s` : ""}${v.missing.length ? `, manquant ${v.missing.join(", ")}` : ""}`,
  templateFlag: (value: string) => `--template nécessite un identifiant de modèle (kebab-case, voir baocut templates) : ${value}`,
};
