import { localizeText, type JobRecord } from '@baocut/protocol';
import { M } from '../cli-copy.ts';

/**
 * 等任务时的进度（Agent 面设计 §5.1、§5.4），一律写 stderr，不碰 stdout 的 JSON：
 *
 * - `--progress jsonl`：每行一个事件 `{ type: 'progress' | 'artifact' | 'warning' | 'done', jobId, … }`；`progress` 带
 *   `state`、`stage`（任务的阶段）与 `pct`（没有总量时 null）。
 * - 默认：stderr 是 TTY 时一行原地刷新，否则状态变化时写一行。
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

  /** 任务记录有变化。 */
  update(job: JobRecord): void {
    const pct = percent(job);
    if (this.#mode === 'jsonl') {
      const key = `${job.state}|${job.phase}|${pct === null ? '' : Math.floor(pct)}`;
      if (key !== this.#last) {
        this.#last = key;
        this.#event({
          type: 'progress',
          jobId: job.jobId,
          state: job.state,
          stage: job.phase,
          pct: pct === null ? null : Math.round(pct * 10) / 10,
        });
      }
    } else {
      const line = `${job.jobId} · ${job.state} · ${job.phase}${pct === null ? '' : ` ${pct.toFixed(0)}%`}${job.attempt > 1 ? ` (#${job.attempt})` : ''}`;
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

function percent(job: JobRecord): number | null {
  const progress = job.progress;
  if (!progress || progress.total === null || progress.total <= 0) return null;
  return Math.min(100, (progress.done / progress.total) * 100);
}
