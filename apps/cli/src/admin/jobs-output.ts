import {
  localizeText,
  type JobCancellation,
  type JobReconcileDecision,
  type JobRecord,
  type ResourceAmounts,
  type ResourceDemand,
  type ResourcesSnapshot,
} from '@baocut/protocol';
import { M } from './jobs-copy.ts';

/**
 * 管理桶 `baocut jobs resources|reconcile` 的参数与输出（架构设计 §7.1–§7.7）：资源调度的现状、对账，以及应用与取消的事实。
 * 任务的列出、查看、等待、取消与重试在 Agent 面（`jobs list|inspect|wait|cancel|retry`）。
 */

export type JobsCommand = { kind: 'resources' } | { kind: 'reconcile'; jobId: string; decision: JobReconcileDecision };

const DECISIONS: readonly JobReconcileDecision[] = ['retry', 'discard', 'apply'];

export function parseJobsArgs(args: string[]): JobsCommand {
  const [action, jobId, decision, ...extra] = args;
  if (action === 'resources') {
    if (jobId !== undefined) throw new Error(M.usage);
    return { kind: 'resources' };
  }
  if (action !== 'reconcile' || !jobId || !decision || extra.length > 0) throw new Error(M.usage);
  if (!(DECISIONS as readonly string[]).includes(decision)) throw new Error(M.badDecision(DECISIONS));
  return { kind: 'reconcile', jobId, decision: decision as JobReconcileDecision };
}

export function jobStateLabel(state: JobRecord['state']): string {
  return M.jobStates[state];
}

/** 取消的三件事实，分开写（§7.4）。 */
export function describeCancellation(cancellation: JobCancellation): string {
  return M.cancellation(Boolean(cancellation.localStoppedAt), M.remoteStates[cancellation.remote], M.costStates[cancellation.cost]);
}

/** `jobs reconcile` 之后的结果。 */
export function formatReconcileResult(decision: JobReconcileDecision, job: JobRecord): string[] {
  const lines: string[] = [];
  if (decision === 'retry') lines.push(M.requeued(job.attempt, job.jobId));
  else if (decision === 'discard') lines.push(M.discarded(job.jobId));
  else {
    const latest = job.applications?.at(-1);
    lines.push(
      latest?.state === 'committed'
        ? M.appliedTo(latest.videoId, Boolean(latest.receipt?.recovered))
        : M.notApplied(latest ? M.applicationStates[latest.state] : M.noApplicationRecord, latest?.error ? localizeText(latest.error.message, latest.error.messageRef) : null),
    );
  }
  lines.push(M.statusLine(jobStateLabel(job.state), job.error ? job.error.code : null));
  if (job.cancellation) lines.push(M.cancellationLine(describeCancellation(job.cancellation)));
  if (job.grant?.settled) lines.push(M.budgetSettled(job.grant.settled.basis, job.grant.settled.calls));
  return lines;
}

const GiB = 1024 * 1024 * 1024;

function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return M.unknown;
  return value >= GiB ? `${(value / GiB).toFixed(1)} GiB` : `${Math.round(value / (1024 * 1024))} MiB`;
}

function amounts(value: ResourceAmounts): string {
  return M.amounts(bytes(value.memory), bytes(value.gpuMemory), value.cpuThreads, bytes(value.scratchDisk));
}

function demand(value: ResourceDemand): string {
  const parts: string[] = [];
  if (value.memory) parts.push(M.demandMemory(bytes(value.memory)));
  if (value.gpuMemory) parts.push(M.demandGpuMemory(bytes(value.gpuMemory)));
  if (value.cpuThreads) parts.push(M.demandCpu(value.cpuThreads));
  if (value.scratchDisk) parts.push(M.demandDisk(bytes(value.scratchDisk)));
  return parts.length > 0 ? parts.join(M.listSep) : M.demandNone;
}

/** `baocut jobs resources`：容量与来源、预留、已租出与还能用的量、租约、常驻进程与排队（架构设计 §7.6、§7.7）。 */
export function formatResources(snapshot: ResourcesSnapshot): string[] {
  const { capacity } = snapshot;
  const sources = M.sources;
  const lines = [
    M.capacity(amounts(capacity), Boolean(capacity.unifiedMemory)),
    M.capacitySources(
      sources[capacity.sources.memory],
      sources[capacity.sources.gpuMemory],
      sources[capacity.sources.cpuThreads],
      sources[capacity.sources.scratchDisk],
    ),
    M.systemReserve(amounts(snapshot.reserves.system)),
    M.interactiveReserve(amounts(snapshot.reserves.interactive)),
    M.leased(amounts(snapshot.leased)),
    M.backgroundAvailable(amounts(snapshot.available.background)),
    M.interactiveAvailable(amounts(snapshot.available.interactive)),
  ];
  lines.push(snapshot.leases.length > 0 ? M.leasesHeader : M.leasesNone);
  for (const lease of snapshot.leases) {
    const extra = [lease.holder ? M.leaseHolder(lease.holder) : null, lease.queue ? M.leaseQueue(lease.queue) : null]
      .filter(Boolean)
      .join(M.clauseSep);
    lines.push(`  ${lease.owner}  ${lease.label}  ${demand(lease.demand)}${extra ? `  ${extra}` : ''}  ${lease.since}`);
  }
  if (snapshot.holders.length > 0) lines.push(M.holdersHeader);
  for (const holder of snapshot.holders) {
    lines.push(`  ${holder.holder}  ${demand(holder.demand)}  ${M.holderState(holder.users, holder.processes)}`);
  }
  lines.push(snapshot.waiting.length > 0 ? M.waitingHeader : M.waitingNone);
  for (const waiter of snapshot.waiting) {
    lines.push(`  ${waiter.owner}  ${waiter.label}  ${demand(waiter.demand)}  ${waiter.wait ? localizeText(waiter.wait.detail, waiter.wait.detailRef) : M.waitingAdmission}`);
  }
  return lines;
}
