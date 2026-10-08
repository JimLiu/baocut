import { pluralForm } from '@baocut/protocol';
import {  type CheckResult, type TaskContract } from '@baocut/protocol';
import type { TasksMessages } from './tasks-copy.ts';

export const fr: TasksMessages = {

  help: `Utilisation :
  baocut tasks contract <task id> [--revision <n>]
                                   Afficher le contrat : objectif, portée, contraintes, éléments à préserver,
                                   livrables, mode d’accès, budget et utilisation, vérifications d’acceptation et résultats
  baocut tasks history <task id>   Historique des révisions du contrat (champs modifiés, auteur et date)
  baocut tasks list --conversation <session id>
                                   Dernier contrat de chaque tâche d’une session`,
  usage: "Utilisation : baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>",
  revisionPositive: "--revision doit être un entier positif",
  changeBy: { user: "vous", agent: "l’Agent", runtime: "Runtime (par défaut)" } satisfies Record<TaskContract['change']['by'], string>,
  changeReason: {
    created: "créé",
    updated: "modifié",
    mode: "mode d’accès modifié",
    goal: "objectif modifié",
  } satisfies Record<TaskContract['change']['reason'], string>,
  outcomeLabels: { passed: "Réussi", failed: "Échec", skipped: "Ignoré" } satisfies Record<CheckResult['outcome'], string>,
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason} par ${by}${fields.length > 0 ? ` : ${fields.join(", ")}` : ""}, ${at}`,
  wholeVideo: "toute la vidéo",
  entity: (id: string) => `entité ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `${paths.join(", ")} de l’entité ${id}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `images ${from}–${to} de la séquence ${sequenceId}${trackIds.length ? ` (pistes ${trackIds.join(", ")})` : ""}`,
  protection: (id: string, videoId: string, what: string, note: string | null) =>
    `${id}  vidéo ${videoId} : ${what}${note ? ` (${note})` : ""}`,
  noBudget: "Sans limite (seul le budget de chaque autorisation s’applique)",
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} réservés` : ""}${max !== null ? `/${max}` : ""} ${pluralForm('fr', calls, { one: "appel", other: "appels" })}`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `, ${spent} dépensés` : ""}${reserved ? `, ${reserved} réservés` : ""}${cap ? `, plafond ${cap}` : ""}${unknownCostCalls ? ` (${unknownCostCalls} au coût inconnu)` : ""}`,
  latest: "dernière",
  latestIs: (revision: number) => `dernière révision : ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `Tâche ${taskId}  révision du contrat ${revision} (${latest})  ${change}`,
  goal: (goal: string) => `Objectif : ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `Session : ${conversationId}  Vidéo : ${videoId ?? "aucun"}${baseRevision ? ` (version ${baseRevision})` : ""}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `Portée : ${s.videoId ? `vidéo ${s.videoId}` : "aucune vidéo indiquée"}${s.sequenceId ? `, séquence ${s.sequenceId}` : ""}${s.itemIds.length ? `, sélection ${s.itemIds.join(", ")}` : ""}${s.range ? `, ${s.range.from}–${s.range.to} s` : ""}`,
  access: (mode: string, scopeRef: string) => `Mode d’accès : ${mode}  Portée des permissions : ${scopeRef}`,
  budgetLine: (budget: string) => `Budget : ${budget}`,
  supersedes: (taskId: string, stopped: boolean) =>
    `Remplace : tâche ${taskId} (le travail de l’ancienne tâche ${stopped ? "a été arrêté" : "est conservé comme candidat"})`,
  constraints: (empty: boolean): string => (empty ? "Contraintes : aucune" : "Contraintes :"),
  protectedRefs: (empty: boolean): string => (empty ? "À préserver : rien" : "À préserver :"),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? ` (${language})` : ""}`,
  deliverables: (items: readonly string[]) => (items.length ? `Livrables : ${items.join(", ")}` : "Livrables : non indiqués"),
  checks: (empty: boolean): string => (empty ? "Vérifications d’acceptation : aucune" : "Vérifications d’acceptation :"),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label} (enregistré par ${byAgent ? "l’Agent" : "vous"}${note ? ` : ${note}` : ""})`,
  notRecorded: "non enregistré",
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? ", requis" : ""}] ${description} — ${outcome}`,
  noContracts: "Aucun contrat",
  historyLine: (revision: number, change: string, mode: string) => `Révision ${revision}  ${change}  mode ${mode}`,
  noTasks: "Cette session n’a pas encore de tâches",
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  révision ${revision}  ${mode}  ${goal}`,
};
