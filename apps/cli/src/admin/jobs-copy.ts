import { defineMessages, type ApplicationState, type JobCancellation, type JobRecord } from '@baocut/protocol';
import { zhHans } from './jobs-copy.zh-Hans.ts';
import { zhHant } from './jobs-copy.zh-Hant.ts';
import { ja } from './jobs-copy.ja.ts';
import { ko } from './jobs-copy.ko.ts';
import { es } from './jobs-copy.es.ts';
import { fr } from './jobs-copy.fr.ts';
import { de } from './jobs-copy.de.ts';
import { nl } from './jobs-copy.nl.ts';
import { ptBR } from './jobs-copy.pt-BR.ts';
import { it } from './jobs-copy.it.ts';
import { ru } from './jobs-copy.ru.ts';
import { pl } from './jobs-copy.pl.ts';
import { tr } from './jobs-copy.tr.ts';
import { vi } from './jobs-copy.vi.ts';

const s = (n: number) => (n === 1 ? '' : 's');

/** `baocut jobs` 的文案（英文是键与类型的来源，译文在 `jobs-copy.<语言>.ts`）。 */
const en = {
  /** `baocut jobs --help` 的正文。 */
  help: `Usage:
  baocut jobs resources            Resource scheduling status: machine capacity and its source, reservations,
                                   leases, resident Model Workers, and what queued tasks are waiting for
  baocut jobs reconcile <jobId> retry|discard|apply
                                   Handle tasks whose result is unclear, or that weren't fully applied, after a
                                   restart: retry runs again (a new call, with grants and budget checked again),
                                   discard abandons outbound calls awaiting reconciliation (budget already charged
                                   isn't refunded), apply revalidates the kept result and applies it to the video`,
  usage: 'Usage: baocut jobs resources | baocut jobs reconcile <jobId> retry|discard|apply',
  badDecision: (choices: readonly string[]) => `Reconcile decision must be one of: ${choices.join(', ')}`,
  jobStates: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    'needs-reconciliation': 'Needs reconciling',
  } satisfies Record<JobRecord['state'], string>,
  applicationStates: {
    pending: 'Pending',
    validating: 'Committing',
    committed: 'Applied',
    'stale-input': 'Target changed',
    rejected: 'Rejected',
    cancelled: 'Not applied',
  } satisfies Record<ApplicationState, string>,
  remoteStates: {
    'not-applicable': 'no remote',
    'not-submitted': 'not sent',
    cancelled: 'cancelled remotely',
    'cancel-unsupported': "remote can't cancel",
    unknown: 'remote unknown',
  } satisfies Record<JobCancellation['remote'], string>,
  costStates: {
    none: 'no charge',
    possible: 'may have been charged',
    charged: 'charged',
  } satisfies Record<JobCancellation['cost'], string>,
  cancellation: (stoppedLocally: boolean, remote: string, cost: string) =>
    `${stoppedLocally ? 'stopped locally' : 'not stopped locally'}, ${remote}, ${cost}`,
  cancellationLine: (text: string) => `Cancellation: ${text}`,
  requeued: (attempt: number, jobId: string) => `Requeued (attempt ${attempt}): ${jobId}`,
  discarded: (jobId: string) => `Discarded: ${jobId}`,
  appliedTo: (videoId: string, recovered: boolean) =>
    `Applied to video ${videoId}${recovered ? ' (it had already been committed last time; the receipt was recorded now)' : ''}`,
  notApplied: (state: string, error: string | null) => `Not applied: ${state}${error ? ` (${error})` : ''}`,
  noApplicationRecord: 'no application record',
  statusLine: (state: string, code: string | null) => `Status: ${state}${code ? `  ${code}` : ''}`,
  budgetSettled: (basis: string, calls: number) => `Budget settled: ${basis}, ${calls} call${s(calls)}`,
  unknown: 'unknown',
  amounts: (memory: string, gpuMemory: string, cpuThreads: number, disk: string) =>
    `Memory ${memory}  GPU memory ${gpuMemory}  CPU ${cpuThreads} thread${s(cpuThreads)}  Disk ${disk}`,
  demandMemory: (value: string) => `memory ${value}`,
  demandGpuMemory: (value: string) => `GPU memory ${value}`,
  demandCpu: (threads: number) => `CPU ${threads} thread${s(threads)}`,
  demandDisk: (value: string) => `disk ${value}`,
  demandNone: 'uses no local resources',
  listSep: ', ',
  clauseSep: ', ',
  sources: {
    system: 'system',
    setting: 'settings',
    'unified-estimate': 'estimated from unified memory',
    unknown: 'unknown',
    statfs: 'free space on the staging volume',
  } as Record<string, string>,
  capacity: (amounts: string, unified: boolean) =>
    `Capacity: ${amounts}${unified ? ' (unified memory: GPU memory also counts as memory)' : ''}`,
  capacitySources: (memory: string | undefined, gpuMemory: string | undefined, cpu: string | undefined, disk: string | undefined) =>
    `  Sources: memory ${memory}, GPU memory ${gpuMemory}, CPU ${cpu}, disk ${disk}`,
  systemReserve: (amounts: string) => `System reserve: ${amounts}`,
  interactiveReserve: (amounts: string) => `Interactive reserve: ${amounts}`,
  leased: (amounts: string) => `Leased: ${amounts}`,
  backgroundAvailable: (amounts: string) => `Available to background: ${amounts}`,
  interactiveAvailable: (amounts: string) => `Available to interactive: ${amounts}`,
  leasesHeader: 'Leases:',
  leasesNone: 'Leases: none',
  leaseHolder: (holder: string) => `uses ${holder}`,
  leaseQueue: (queue: string) => `queue ${queue}`,
  holdersHeader: 'Resident processes:',
  holderState: (users: number, processes: number) =>
    `${users > 0 ? `in use by ${users} task${s(users)}` : 'idle'}, ${processes} process${processes === 1 ? '' : 'es'} still running`,
  waitingHeader: 'Waiting:',
  waitingNone: 'Waiting: none',
  waitingAdmission: 'waiting for admission',
};

export type JobsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
