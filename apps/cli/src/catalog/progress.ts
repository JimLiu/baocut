import { localizeText, type JobRecord } from '@baocut/protocol';
import { M } from '../cli-copy.ts';

/**
 * 等任务时的进度（Agent 面设计 §5.1、§5.4），一律写 stderr，不碰 stdout 的 JSON：
 *
 * - `--progress jsonl`：每行一个事件 `{ type: 'progress' | 'artifact' | 'warning' | 'done', jobId, … }`；`progress` 带
 *   `state`、`stage`（任务的阶段）与 `pct`（没有总量时 null），有进度时再带 `done`、`total`、`unit`，
 *   本机生图按步报进度时带 `remainingSec`（预计剩余秒数，算不出时 null；命令协议 §4.1）。固定流程的 `pct` 与 `done`
 *   数的是步骤；正在执行的那一步的子任务有进度时另带 `step: { jobId, stage, pct, done, total, unit }`（例如转写对齐的段数）。
 * - 默认：stderr 是 TTY 时一行原地刷新，否则状态变化时写一行；按步的进度写 `3/8`，有预计剩余时接一句剩余时间。
 *   固定流程写完成了几步，再接这一步的阶段与进度：`2/4 · aligning 67% (333/496 segments)`，不把步骤的百分比写在阶段旁边。
 */
export type ProgressMode = 'jsonl' | 'text';

type Stream = NodeJS.WritableStream & { isTTY?: boolean };

export class ProgressReporter {
  readonly #mode: ProgressMode;
  readonly #stream: Stream;
  readonly #tty: boolean;
  #last = '';
  #open = false;
  readonly #warnings = new Set<string>();
  readonly #artifacts = new Set<string>();

  constructor(mode: ProgressMode | undefined, stream: Stream) {
    this.#mode = mode ?? 'text';
    this.#stream = stream;
    this.#tty = Boolean(stream.isTTY);
  }

  /**
   * 任务记录有变化。`step` 是固定流程正在执行的那一步的子任务（`waitForJob` 从 `jobs` 主题的镜像里取）；
   * 别的任务、或这一步还没开始时没有。
   */
  update(job: JobRecord, step?: JobRecord | null): void {
    const pct = percent(job);
    const sp = step?.state === 'running' ? step.progress : null;
    const stepPct = sp ? percent(step!) : null;
    if (this.#mode === 'jsonl') {
      const p = job.progress;
      const stepKey = sp ? `${step!.phase}|${stepPct === null ? sp.done : Math.floor(stepPct)}` : '';
      const key = `${job.state}|${job.phase}|${pct === null ? '' : Math.floor(pct)}|${p?.remainingSec ?? ''}|${stepKey}`;
      if (key !== this.#last) {
        this.#last = key;
        this.#event({
          type: 'progress',
          jobId: job.jobId,
          state: job.state,
          stage: job.phase,
          pct: pct === null ? null : Math.round(pct * 10) / 10,
          ...(p ? { done: p.done, total: p.total, unit: p.unit } : {}),
          ...(p && p.remainingSec !== undefined ? { remainingSec: p.remainingSec } : {}),
          ...(sp
            ? {
                step: {
                  jobId: step!.jobId,
                  stage: step!.phase,
                  pct: stepPct === null ? null : Math.round(stepPct * 10) / 10,
                  done: sp.done,
                  total: sp.total,
                  unit: sp.unit,
                },
              }
            : {}),
        });
      }
    } else {
      const p = job.progress;
      const steps = p?.unit === 'steps' && p.total !== null ? `${p.done}/${p.total}` : '';
      const left = typeof p?.remainingSec === 'number' ? ` · ${M.jobRemaining(clock(p.remainingSec))}` : '';
      const attempt = job.attempt > 1 ? ` (#${job.attempt})` : '';
      // 固定流程：完成了几步，再接这一步在做什么、做到哪（步骤的百分比不写在阶段旁边）。
      const head =
        job.pipeline && steps
          ? `${steps} · ${job.phase}${sp ? ` ${stepAmount(sp, stepPct)}` : ''}`
          : `${job.phase}${pct === null ? '' : ` ${pct.toFixed(0)}%`}${steps ? ` ${steps}` : ''}`;
      const line = `${job.jobId} · ${job.state} · ${head}${left}${attempt}`;
      if (line !== this.#last) {
        this.#last = line;
        this.#line(line);
      }
    }
    for (const warning of job.warnings) {
      const key = `${warning.code}|${warning.detail ?? ''}`;
      if (this.#warnings.has(key)) continue;
      this.#warnings.add(key);
      const detail = localizeText(warning.detail, warning.detailRef) ?? null;
      if (this.#mode === 'jsonl') this.#event({ type: 'warning', jobId: job.jobId, code: warning.code, detail });
      else this.#message(`[warning] ${warning.code}${detail ? `: ${detail}` : ''}`);
    }
    for (const output of job.result?.outputs ?? []) {
      if (this.#artifacts.has(output.artifactId)) continue;
      this.#artifacts.add(output.artifactId);
      if (this.#mode === 'jsonl')
        this.#event({ type: 'artifact', jobId: job.jobId, artifactId: output.artifactId, mediaType: output.mediaType });
    }
  }

  done(job: JobRecord): void {
    if (this.#mode === 'jsonl')
      this.#event({ type: 'done', jobId: job.jobId, state: job.state, ...(job.error ? { code: job.error.code } : {}) });
    else this.#close();
  }

  /** 一行说明（取消中、等待超时）。 */
  note(text: string): void {
    if (this.#mode === 'jsonl') return;
    this.#message(text);
  }

  cancelling(jobId: string): void {
    if (this.#mode === 'jsonl') this.#event({ type: 'cancelling', jobId });
    else this.#message(M.jobCancelling(jobId));
  }

  #event(event: Record<string, unknown>): void {
    this.#stream.write(`${JSON.stringify(event)}\n`);
  }

  #line(text: string): void {
    if (this.#tty) {
      this.#stream.write(`\r\x1b[K${text}`);
      this.#open = true;
    } else this.#stream.write(`${text}\n`);
  }

  #message(text: string): void {
    this.#close();
    this.#stream.write(`${text}\n`);
  }

  #close(): void {
    if (!this.#open) return;
    this.#stream.write('\n');
    this.#open = false;
  }
}

/** 剩余时间 `0:45`、`12:03`，超过一小时 `1:02:03`（与界面的剩余时间同一个写法）。 */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 一步做到哪：`67% (333/496 segments)`；按秒的写成时钟 `11% (20:34 / 2:57:07)`；没有总量时只写做了多少。 */
function stepAmount(progress: NonNullable<JobRecord['progress']>, pct: number | null): string {
  const seconds = progress.unit === 'seconds';
  const amount = (value: number) => (seconds ? clock(value) : String(Math.round(value)));
  if (progress.total === null || pct === null) return seconds ? amount(progress.done) : `${amount(progress.done)} ${progress.unit}`;
  const span = seconds ? `${amount(progress.done)} / ${amount(progress.total)}` : `${amount(progress.done)}/${amount(progress.total)} ${progress.unit}`;
  return `${pct.toFixed(0)}% (${span})`;
}

function percent(job: JobRecord): number | null {
  const progress = job.progress;
  if (!progress || progress.total === null || progress.total <= 0) return null;
  return Math.min(100, (progress.done / progress.total) * 100);
}
