import {  type ApplicationState, type JobCancellation, type JobRecord } from '@baocut/protocol';
const s = (n: number) => pluralForm('fr', n, { one: '', other: 's' });
import { pluralForm } from '@baocut/protocol';
import type { JobsMessages } from './jobs-copy.ts';

export const fr: JobsMessages = {

  help: `Utilisation :
  baocut jobs resources            État de planification : capacité de l’ordinateur et source, réservations,
                                   allocations, Model Workers résidents et motifs d’attente des tâches en file
  baocut jobs reconcile <jobId> retry|discard|apply
                                   Traiter après redémarrage les tâches au résultat incertain ou partiellement appliqué :
                                   retry réexécute (nouvel appel, autorisations et budget revérifiés),
                                   discard abandonne les appels sortants à rapprocher (budget déjà facturé non remboursé),
                                   apply revalide le résultat conservé et l’applique à la vidéo`,
  usage: "Utilisation : baocut jobs resources | baocut jobs reconcile <jobId> retry|discard|apply",
  badDecision: (choices: readonly string[]) => `La décision de rapprochement doit être une valeur parmi : ${choices.join(", ")}`,
  jobStates: {
    queued: "En file",
    running: "En cours",
    completed: "Terminé",
    failed: "Échec",
    cancelled: "Annulé",
    interrupted: "Interrompu",
    'needs-reconciliation': "Rapprochement requis",
  } satisfies Record<JobRecord['state'], string>,
  applicationStates: {
    pending: "En attente",
    validating: "Validation en cours",
    committed: "Appliqué",
    'stale-input': "Cible modifiée",
    rejected: "Refusé",
    cancelled: "Non appliqué",
  } satisfies Record<ApplicationState, string>,
  remoteStates: {
    'not-applicable': "aucun traitement distant",
    'not-submitted': "non envoyé",
    cancelled: "annulé à distance",
    'cancel-unsupported': "annulation distante impossible",
    unknown: "état distant inconnu",
  } satisfies Record<JobCancellation['remote'], string>,
  costStates: {
    none: "aucun coût",
    possible: "coût possible",
    charged: "facturé",
  } satisfies Record<JobCancellation['cost'], string>,
  cancellation: (stoppedLocally: boolean, remote: string, cost: string) =>
    `${stoppedLocally ? "arrêté localement" : "non arrêté localement"}, ${remote}, ${cost}`,
  cancellationLine: (text: string) => `Annulation : ${text}`,
  requeued: (attempt: number, jobId: string) => `Remis en file (tentative ${attempt}) : ${jobId}`,
  discarded: (jobId: string) => `Abandonné : ${jobId}`,
  appliedTo: (videoId: string, recovered: boolean) =>
    `Appliqué à la vidéo ${videoId}${recovered ? " (déjà validé la dernière fois ; reçu enregistré maintenant)" : ""}`,
  notApplied: (state: string, error: string | null) => `Non appliqué : ${state}${error ? ` (${error})` : ""}`,
  noApplicationRecord: "aucun enregistrement d’application",
  statusLine: (state: string, code: string | null) => `État : ${state}${code ? `  ${code}` : ""}`,
  budgetSettled: (basis: string, calls: number) => `Budget réglé : ${basis}, ${calls} appel${s(calls)}`,
  unknown: "inconnu",
  amounts: (memory: string, gpuMemory: string, cpuThreads: number, disk: string) =>
    `Mémoire ${memory}  Mémoire GPU ${gpuMemory}  CPU ${cpuThreads} thread${s(cpuThreads)}  Disque ${disk}`,
  demandMemory: (value: string) => `mémoire ${value}`,
  demandGpuMemory: (value: string) => `mémoire GPU ${value}`,
  demandCpu: (threads: number) => `CPU ${threads} thread${s(threads)}`,
  demandDisk: (value: string) => `disque ${value}`,
  demandNone: "n’utilise aucune ressource locale",
  listSep: ", ",
  clauseSep: ", ",
  sources: {
    system: "système",
    setting: "réglages",
    'unified-estimate': "estimée à partir de la mémoire unifiée",
    unknown: "inconnu",
    statfs: "espace libre sur le volume temporaire",
  } as Record<string, string>,
  capacity: (amounts: string, unified: boolean) =>
    `Capacité : ${amounts}${unified ? " (mémoire unifiée : la mémoire GPU compte aussi comme mémoire)" : ""}`,
  capacitySources: (memory: string | undefined, gpuMemory: string | undefined, cpu: string | undefined, disk: string | undefined) =>
    `  Sources : mémoire ${memory}, mémoire GPU ${gpuMemory}, CPU ${cpu}, disque ${disk}`,
  systemReserve: (amounts: string) => `Réserve système : ${amounts}`,
  interactiveReserve: (amounts: string) => `Réserve interactive : ${amounts}`,
  leased: (amounts: string) => `Alloué : ${amounts}`,
  backgroundAvailable: (amounts: string) => `Disponible en arrière-plan : ${amounts}`,
  interactiveAvailable: (amounts: string) => `Disponible pour l’interactif : ${amounts}`,
  leasesHeader: "Allocations :",
  leasesNone: "Allocations : aucune",
  leaseHolder: (holder: string) => `utilise ${holder}`,
  leaseQueue: (queue: string) => `file ${queue}`,
  holdersHeader: "Processus résidents :",
  holderState: (users: number, processes: number) =>
    `${users > 0 ? `utilisé par ${users} tâche${s(users)}` : "inactif"}, ${processes} processus encore en cours`,
  waitingHeader: "En attente :",
  waitingNone: "En attente : aucun",
  waitingAdmission: "en attente d’admission",
};
