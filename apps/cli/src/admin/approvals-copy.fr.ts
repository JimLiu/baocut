import {  type RiskLevel } from '@baocut/protocol';
import type { ApprovalsMessages } from './approvals-copy.ts';

export const fr: ApprovalsMessages = {

  help: `Utilisation :
  baocut approvals                 Lister les approbations en attente, des sessions et services externes
  baocut approvals allow <id>      Autoriser une approbation en attente ; celles qui partagent des données
                                   ne sont autorisées qu’une fois par défaut (montant inconnu)
    --persist                      Accorder aussi une autorisation permanente (ce partage ne sera plus demandé)
    --scope <video|all>            Portée de l’autorisation : vidéo de cet appel (par défaut) ou toutes les vidéos
    --max-calls <n>                Limite d’appels de l’autorisation permanente
    --budget <amount> --currency <currency>
                                   Limite de dépenses (modèles avec tarifs uniquement ;
                                   les appels au coût impossible à estimer exigent toujours une approbation)
    --expires <ISO time>           Expiration de l’autorisation permanente
  baocut approvals deny <id>       Refuser une approbation en attente`,
  persistNeedsAllow: "--persist s’utilise uniquement avec allow",
  alreadyResolved: (id: string) => `L’approbation ${id} a déjà été traitée, a expiré ou a été annulée (ou n’existe pas)`,
  allowed: (id: string) => `Autorisé : ${id}`,
  denied: (id: string) => `Refusé : ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `Mode d’accès inconnu : ${value}. --mode accepte ${flags.join(", ")}`,
  mode: (label: string, flag: string) => `${label} (${flag})`,
  usage: "Utilisation : baocut approvals [list | allow <approval id> | deny <approval id>]",
  riskLabels: { read: "Lecture", edit: "Modifier", command: "Commande", high: "Risque élevé" } satisfies Record<RiskLevel, string>,
  none: "Aucune approbation en attente",
  fromSession: (title: string) => `Session « ${title} »`,
  fromService: (serviceId: string, clientName: string) => `Service ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `mode ${mode}`,
  basisLevel: (level: string) => `niveau ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) =>
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(", ")}` : ""}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? "" : `, refus automatique dans ${a.secondsLeft} s`})`,
  runCommand: (command: string) => `Exécuter la commande : ${command}`,
  changeFiles: (files: readonly string[]) => `Modifier les fichiers : ${files.join(", ")}`,
  callTool: (tool: string, files: readonly string[]) => `Appeler ${tool}${files.length > 0 ? ` : ${files.join(", ")}` : ""}`,
};
