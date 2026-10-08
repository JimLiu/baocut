import {  type Grant } from '@baocut/protocol';
import { pluralForm } from '@baocut/protocol';
import type { GrantsMessages } from './grants-copy.ts';

export const fr: GrantsMessages = {

  help: `Utilisation :
  baocut grants [list]             Lister les autorisations de partage (fournisseurs en ligne et Agent) :
                                   destinataire, types de données, portée, utilisation et budget
    --recipient <id>               Autorisations de ce fournisseur uniquement
    --video <video id>             Autorisations couvrant cette vidéo uniquement
    --include-ended                Inclure les autorisations révoquées, expirées et épuisées
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Accorder une autorisation. Types : transcript (transcriptions et traductions), frames (images vidéo),
                                   audio (audio), video (vidéo originale), document (texte et prompts), context (contexte de l’Agent)
    --video <video id|all>         Couvrir cette vidéo uniquement ; absent ou all couvre toutes les vidéos
    --max-calls <n>                Limite d’appels ; illimités si absent
    --budget <amount> --currency <currency>
                                   Limite de dépenses : estimée et réservée selon le tarif du modèle ;
                                   les appels aux modèles sans tarif sont refusés (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Date d’expiration
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Modifier une autorisation ; réduire portée ou limites, ou avancer l’expiration
                                   fait refuser au démarrage les appels en file sous les anciennes conditions
  baocut grants revoke <id>        Révoquer une autorisation : futurs appels refusés ; données déjà
                                   envoyées et dépenses déjà comptées restent déclarées telles quelles
  baocut grants usage <id>         Utilisation et tâches ayant utilisé l’autorisation (réservations et règlements)`,
  usage:
    "Utilisation : baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]" +
    " | update <grant id> [options] | revoke <grant id> | usage <grant id>]",
  listSep: ", ",
  missingRecipient: "--recipient manquant (fournisseur recevant les données, par exemple openai)",
  missingData: (kinds: readonly string[]) => `--data manquant (types de données séparés par des virgules : ${kinds.join(", ")})`,
  missingPurpose: "--purpose manquant (une phrase lisible par une personne)",
  recipientFixed: "Le destinataire ne peut pas être modifié : révoquez cette autorisation et créez-en une autre",
  nothingToUpdate: "Rien à modifier : indiquez --data, --video, --purpose, --max-calls, --budget ou --expires",
  persistOnly: "--scope, --max-calls, --budget et --expires s’utilisent uniquement avec --persist",
  scopeChoices: "--scope accepte video ou all",
  unknownKinds: (unknown: string, kinds: readonly string[]) => `Type de données inconnu : ${unknown}. Choisissez parmi ${kinds.join(", ")}`,
  maxCallsRange: "--max-calls doit être un entier de 1 à 1000000, ou none (sans limite)",
  currencyNeedsBudget: "--currency s’utilise uniquement avec --budget",
  budgetFormat: "--budget doit être un montant décimal positif ou nul, avec au plus 6 décimales (par exemple 5 ou 2.50)",
  budgetNeedsCurrency: "--budget nécessite --currency <code de devise à trois lettres, par exemple USD>",
  expiresFormat: "--expires doit être une date ISO avec fuseau horaire (par exemple 2026-12-31T23:59:59Z), ou none",
  stateLabels: {
    active: "Actif",
    expired: "Expiré",
    revoked: "Révoqué",
    exhausted: "Épuisé",
  } satisfies Record<Grant['state'], string>,
  originLabels: {
    user: "accordée par vous",
    approval: "accordée lors de l’approbation",
    'provider-enable': "par défaut à l’activation",
  } satisfies Record<Grant['origin'], string>,
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} réservés` : ""}${max !== null ? `/${max}` : ""} ${pluralForm('fr', calls, { one: "appel", other: "appels" })}`,
  unknownCostCalls: (n: number) => ` (${n} au coût inconnu)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}, ${amount}${reserved ? `+${reserved} réservés` : ""}/${cap} ${currency}`,
  noGrants: "Aucune autorisation : les appels aux fournisseurs en ligne et Agent demanderont une approbation (ou créez-en une avec baocut grants create)",
  scopeVideo: (videoId: string) => `vidéo ${videoId}`,
  scopeAll: "toutes les vidéos",
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) =>
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, uniquement la tâche ${g.taskId}` : ""}${g.once ? ", cette fois uniquement" : ""}  utilisation ${g.usage}${g.expiresAt ? `, expire ${g.expiresAt}` : ""}  (${g.origin} : ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `Révoqué : ${id} (${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `Déjà envoyé : ${calls} ${pluralForm('fr', calls, { one: "appel", other: "appels" })}${amount ? `, ${amount} comptabilisés` : ""}${unknownCostCalls ? ` (${unknownCostCalls} au coût inconnu)` : ""}`,
  runningJobs: (jobs: readonly string[]) => `Tâches encore en cours (elles se termineront normalement) : ${jobs.join(", ")}`,
  noJobs: "(Aucune tâche ne l’a encore utilisée, ou les enregistrements ont été nettoyés)",
  settled: (calls: number, amount: string, basis: string) => `réglé : ${calls} ${pluralForm('fr', calls, { one: "appel", other: "appels" })} ${amount} (${basis})`,
  unsettled: "non réglé",
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  réservé : ${calls} ${pluralForm('fr', calls, { one: "appel", other: "appels" })} ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    Envoie : ${a.recipient} ← ${a.kinds}${a.videoId ? ` (vidéo ${a.videoId})` : ""} : ${a.purpose}${a.estimate ? `, estimation ${a.estimate}` : ", coût inconnu"}${a.maxCalls !== null ? `, au plus ${a.maxCalls} ${pluralForm('fr', a.maxCalls, { one: "appel", other: "appels" })}` : ""}${a.reason === 'revoked' ? ", autorisation révoquée ou expirée" : a.reason === 'unverifiable' ? ", impossible d’estimer le coût" : ""}`,
};
