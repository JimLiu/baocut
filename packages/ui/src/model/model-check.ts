import { localizeText, modelCheckCode, modelCheckRepair, type JobRecord, type ModelBundleStatus, type ModelCheckCode } from '@baocut/protocol';
import { agoLabel } from './format.ts';
import {
  CHECK_DETAIL,
  CHECK_HEAD,
  CHECK_LABEL,
  CHECK_NOT_STARTED,
  CHECK_NOT_STARTED_UNKNOWN,
  CHECK_PHASE,
  CHECK_SENTENCES,
  CHECK_UNKNOWN,
  TRY_FAILURE,
  TRY_NOTICE,
  TRY_SUBJECT,
  sentence,
  type CheckSubject,
  type TrySubject,
} from './model-check-copy.ts';
import { installProgressView } from './models-install.ts';
import { isBundleInstalled } from './models-local.ts';

/**
 * 本地模型的「检查」（设计稿 model-local-check.js；架构设计 §6.3）：模型能不能正常使用只在行上一条状态里说。
 * 状态全从 Runtime 来：`modelTest` / `modelInstall` 任务（`jobs` 主题）与模型包上记下的 `selfTest`（`models` 主题）；
 * 本地只记两件 Runtime 不知道的事：提交被拒（检查没能开始）与这一行发起的修复任务（修完要自动再检查）。
 */

export type CheckProblemKind = 'failed' | 'not-started';

export interface CheckProblem {
  kind: CheckProblemKind;
  /** 认得的检查代码；认不得时 null（说法用通用的一句）。 */
  code: ModelCheckCode | null;
  /** 技术详情里的代码：检查代码，没有时用任务或拒绝的原始错误码。 */
  rawCode: string | null;
  text: string;
  todo: string;
  repair: 'yes' | 'maybe' | 'no';
  /** Runtime 的原话（技术详情）。 */
  message: string | null;
  /** Runtime 给的 `key: value` 行（技术详情）。 */
  facts: string[];
}

export type CheckState =
  | { phase: 'idle' }
  | { phase: 'checking'; jobId: string; label: string; percent: number | null }
  | { phase: 'repairing'; jobId: string; percent: number | null }
  | { phase: 'passed'; at: string }
  | { phase: 'failed'; at: string; problem: CheckProblem };

/** 提交被拒：检查没能开始（`APP_FILE_MISSING` 除外，那是检查没通过）。 */
export interface CheckRejection {
  at: string;
  code: string | null;
  message: string;
  details?: unknown;
}

export interface CheckInputs {
  bundle: ModelBundleStatus;
  jobs: readonly JobRecord[];
  subject: CheckSubject;
  rejection?: CheckRejection | null;
  /** 这一行发起的修复任务（`models.repair` 的 `modelInstall`）。 */
  repairJobId?: string | null;
}

const LIVE: readonly JobRecord['state'][] = ['queued', 'running'];
/** 取消与被打断的检查不留结论：状态回到这次之前的样子。 */
const DROPPED: readonly JobRecord['state'][] = ['cancelled', 'interrupted'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** 检查没通过：代码 → 说法与修复规则。 */
export function failedProblem(
  input: { code: unknown; rawCode?: string | null; message?: string | null; facts?: readonly string[] },
  subject: CheckSubject,
): CheckProblem {
  const code = modelCheckCode(input.code);
  const sentence = code ? CHECK_SENTENCES[code](subject) : CHECK_UNKNOWN;
  return {
    kind: 'failed',
    code,
    rawCode: code ?? input.rawCode ?? null,
    ...sentence,
    repair: modelCheckRepair(code),
    message: input.message ?? null,
    facts: [...(input.facts ?? [])],
  };
}

/**
 * 提交被拒 → 状态行。随应用分发的文件缺失是检查没通过（重新安装 BaoCut）；其余是检查没能开始。
 * 连不上 Runtime（客户端的 `internal`，没有 `details.code`）说后台服务没响应。
 */
export function rejectionProblem(rejection: CheckRejection, subject: CheckSubject): CheckProblem {
  if (rejection.code === 'APP_FILE_MISSING') {
    return failedProblem({ code: 'APP_FILE_MISSING', message: rejection.message, facts: rejectionFacts(rejection.details) }, subject);
  }
  const sentence = (rejection.code && CHECK_NOT_STARTED[rejection.code]) || CHECK_NOT_STARTED_UNKNOWN;
  return {
    kind: 'not-started',
    code: null,
    rawCode: rejection.code,
    ...sentence,
    repair: 'no',
    message: rejection.message,
    facts: rejectionFacts(rejection.details),
  };
}

/** 拒绝的 `details` 里给人看的：只要短的字符串与数字，不要本机路径。 */
function rejectionFacts(details: unknown): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(asRecord(details))) {
    if (key === 'code' || key === 'file') continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value);
    if (/^([A-Za-z]:\\|\/)/.test(text) || text.length > 200) continue;
    lines.push(`${key}: ${text}`);
  }
  return lines;
}

/** 一次 RPC 失败 → 拒绝记录：错误码在 `details.code`；连不上 Runtime 时记成 `RUNTIME_UNREACHABLE`。 */
export function rejectionOf(error: unknown, at = new Date().toISOString()): CheckRejection {
  const message = error instanceof Error ? error.message : String(error);
  const rpc = error as { code?: unknown; details?: unknown } | null;
  const details = rpc?.details;
  const code = asRecord(details).code;
  if (typeof code === 'string') return { at, code, message, details };
  const unreachable = !rpc || typeof rpc.code !== 'string' || (rpc.code === 'internal' && details === undefined);
  return { at, code: unreachable ? 'RUNTIME_UNREACHABLE' : null, message, details };
}

/** 检查任务的阶段：用任务真实的 `phase`；总量已知时才有百分比。 */
export function checkPhase(job: Pick<JobRecord, 'phase' | 'progress'>): { label: string; percent: number | null } {
  const p = job.progress;
  const percent = p && p.total ? Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100))) : null;
  switch (job.phase) {
    case 'queued':
      return { label: CHECK_PHASE.queued, percent: null };
    case 'starting':
    case 'loading':
      return { label: CHECK_PHASE.loading, percent: null };
    case 'validating':
    case 'publishing':
    case 'finalizing':
    case 'applying':
    case 'done':
      return { label: CHECK_PHASE.verifying, percent: null };
    default:
      return { label: CHECK_PHASE.running, percent };
  }
}

function latestTest(jobs: readonly JobRecord[], bundleId: string): JobRecord | null {
  let latest: JobRecord | null = null;
  for (const job of jobs) {
    if (job.kind !== 'modelTest' || job.bundleId !== bundleId || DROPPED.includes(job.state)) continue;
    if (!latest || job.createdAt > latest.createdAt) latest = job;
  }
  return latest;
}

/**
 * 行上的检查状态。先看这一行发起的修复在不在跑，再看最近一次（没取消的）检查任务在不在跑；结论按时间取最新的一个：
 * 模型包上记下的 `selfTest`、没记进去的失败任务（例如 `APP_FILE_MISSING`），或提交被拒。
 */
export function checkState({ bundle, jobs, subject, rejection = null, repairJobId = null }: CheckInputs): CheckState {
  if (repairJobId) {
    const job = jobs.find((j) => j.jobId === repairJobId);
    const installing = bundle.install && bundle.install.jobId === repairJobId && bundle.install.state !== 'paused';
    if (installing || (job && LIVE.includes(job.state))) {
      const percent = installing ? installProgressView(bundle.install!).percent : null;
      return { phase: 'repairing', jobId: repairJobId, percent };
    }
  }
  const job = latestTest(jobs, bundle.bundleId);
  if (job && LIVE.includes(job.state)) return { phase: 'checking', jobId: job.jobId, ...checkPhase(job) };

  type Verdict = { at: string; state: CheckState };
  const verdicts: Verdict[] = [];
  const result = bundle.selfTest;
  if (result) {
    verdicts.push({
      at: result.at,
      state:
        result.state === 'passed'
          ? { phase: 'passed', at: result.at }
          : {
              phase: 'failed',
              at: result.at,
              problem: failedProblem(
                { code: result.code, rawCode: 'MODEL_SELF_TEST_FAILED', message: localizeText(result.detail, result.detailRef) ?? null, facts: result.facts },
                subject,
              ),
            },
    });
  }
  if (job?.state === 'failed' && job.error && job.jobId !== result?.jobId) {
    const details = asRecord(job.error.details);
    const code = details.check ?? (job.error.code === 'APP_FILE_MISSING' ? 'APP_FILE_MISSING' : null);
    verdicts.push({
      at: job.updatedAt,
      state: {
        phase: 'failed',
        at: job.updatedAt,
        problem: failedProblem({ code, rawCode: job.error.code, message: localizeText(job.error.message, job.error.messageRef), facts: strings(details.facts) }, subject),
      },
    });
  }
  if (rejection)
    verdicts.push({ at: rejection.at, state: { phase: 'failed', at: rejection.at, problem: rejectionProblem(rejection, subject) } });
  if (!verdicts.length) return { phase: 'idle' };
  verdicts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return verdicts[0]!.state;
}

/**
 * 这一行发起的修复任务怎样了：还在跑（或任务列表里还没有它）null；完成了 `check`（自动再检查一次）；
 * 失败、取消或被打断 `drop`（不检查，原因照常写在行上）。
 */
export function repairOutcome(jobs: readonly JobRecord[], repairJobId: string | null): 'check' | 'drop' | null {
  if (!repairJobId) return null;
  const job = jobs.find((j) => j.jobId === repairJobId);
  if (!job || LIVE.includes(job.state)) return null;
  return job.state === 'completed' ? 'check' : 'drop';
}

/** 这一行现在能怎样检查：直接提交；先重新启用（上次加载失败被停用）再提交；或不能检查。 */
export type CheckRoute = 'test' | 'enable-then-test' | null;

const USABLE: readonly ModelBundleStatus['state'][] = ['installed', 'loading', 'ready', 'busy', 'unloading'];

/**
 * 这类模型包有没有检查：「说话人区分」（`capability: 'diarize'`）自己不跑任务、不加载 Worker，`models.test` 以 `unsupported` 拒绝，
 * 行上与 ⋯ 里都不给「检查」（设计稿 settings-local.jsx 的模型包那一行）。
 */
export function hasCheck(bundle: Pick<ModelBundleStatus, 'capability'>): boolean {
  return bundle.capability !== 'diarize';
}

export function checkRoute(bundle: ModelBundleStatus): CheckRoute {
  if (!hasCheck(bundle) || !isBundleInstalled(bundle)) return null;
  if (bundle.install && bundle.install.state !== 'paused') return null;
  if (bundle.reason === 'unsupported' || bundle.reason === 'worker-missing' || bundle.reason === 'relocating') return null;
  if (USABLE.includes(bundle.state)) return 'test';
  // 加载失败被停用的（文件坏了、内存不够）：重新检查先解除停用，否则 Runtime 以 `MODEL_UNAVAILABLE` 拒绝。
  if (bundle.reason === 'load-failed' || bundle.reason === 'resource') return 'enable-then-test';
  return null;
}

// ---- 视图 ----

export type CheckActionKey = 'cancel' | 'repair' | 'recheck' | 'details';

export interface CheckAction {
  k: CheckActionKey;
  label: string;
  primary?: boolean;
}

export interface CheckLineView {
  tone: 'running' | 'passed' | 'failed';
  /** 「检查中…」「检查没通过」「检查没能开始」；通过时没有。 */
  head: string | null;
  text: string;
  todo: string | null;
  /** 在跑时的进度；总量未知时 null（进度条不确定）。 */
  percent: number | null;
  actions: CheckAction[];
}

/** 行上能做的事：修复（装好了、没在装）与重新检查（`checkRoute` 不为 null）。 */
export interface CheckAbilities {
  repair: boolean;
  recheck: boolean;
}

/** 行上那一条：没检查过 null；检查中有阶段、进度与取消；通过一句安静的话；没通过一句人话 + 怎么办 + 动作。 */
export function checkLineView(state: CheckState, can: CheckAbilities, now = Date.now()): CheckLineView | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'checking':
      return { tone: 'running', head: CHECK_HEAD.running, text: state.label, todo: null, percent: state.percent, actions: [cancel()] };
    case 'repairing':
      return {
        tone: 'running',
        head: CHECK_HEAD.repairing,
        text: CHECK_PHASE.repairing,
        todo: null,
        percent: state.percent,
        actions: [cancel()],
      };
    case 'passed':
      return { tone: 'passed', head: null, text: CHECK_DETAIL.passed(agoLabel(state.at, now)), todo: null, percent: null, actions: [] };
    case 'failed': {
      const p = state.problem;
      return {
        tone: 'failed',
        head: p.kind === 'not-started' ? CHECK_HEAD.notStarted : CHECK_HEAD.failed,
        text: sentence(p.text),
        todo: p.todo,
        percent: null,
        actions: [...problemActions(p, can), { k: 'details', label: CHECK_LABEL.details }],
      };
    }
  }
}

function cancel(): CheckAction {
  return { k: 'cancel', label: CHECK_LABEL.cancel };
}

function problemActions(p: CheckProblem, can: CheckAbilities): CheckAction[] {
  const actions: CheckAction[] = [];
  if (p.repair !== 'no' && can.repair) actions.push({ k: 'repair', label: CHECK_LABEL.repair, primary: true });
  if (can.recheck) actions.push({ k: 'recheck', label: CHECK_LABEL.recheck });
  return actions;
}

/** 「技术详情」：代码、模型与时间、Runtime 的原话与技术细节。复制也用它。 */
export function checkDetailLines(state: CheckState, bundleId: string, now = Date.now()): string[] {
  if (state.phase !== 'failed') return [];
  const p = state.problem;
  return [
    CHECK_DETAIL.code(p.rawCode ?? '—'),
    CHECK_DETAIL.model(bundleId, agoLabel(state.at, now)),
    ...(p.message ? [CHECK_DETAIL.message(p.message)] : []),
    ...p.facts,
  ];
}

export interface TryNoteView {
  text: string;
  todo: string | null;
  actions: TryAction[];
  /** 提醒说的那次检查在什么时候（`tryNotice` 才有）：之后试用做成了就撤掉（`noticeAfterTry`）。 */
  at?: string;
}

export type TryActionKey = 'repair' | 'recheck' | 'check' | 'retry' | 'pickRef' | 'useSample';

export interface TryAction {
  k: TryActionKey;
  label: string;
  primary?: boolean;
}

/** 试用面板开头的提醒：上次检查没通过就先说（没能开始的不算，那次没检查）。 */
export function tryNotice(state: CheckState, can: CheckAbilities, subject: TrySubject = TRY_SUBJECT): TryNoteView | null {
  if (state.phase !== 'failed' || state.problem.kind !== 'failed') return null;
  const p = state.problem;
  const actions: TryAction[] = [];
  if (p.repair !== 'no' && can.repair) actions.push({ k: 'repair', label: CHECK_LABEL.repair, primary: true });
  if (can.recheck) actions.push({ k: 'recheck', label: CHECK_LABEL.recheck });
  return { text: sentence(TRY_NOTICE.text(p.text)), todo: subject.noticeTodo(p.todo), actions, at: state.at };
}

/**
 * 那次检查之后试用做成了（`okAt` 是做成的那次结束的时间），提醒就撤掉：再说「现在试听多半也会失败」与眼前的结果矛盾。
 * 行上那条检查结果照旧，重新检查才会换掉它；之后又检查没通过，提醒照样出来。
 */
export function noticeAfterTry(notice: TryNoteView | null, okAt: string | null | undefined): TryNoteView | null {
  if (!notice?.at || !okAt) return notice;
  return Date.parse(okAt) > Date.parse(notice.at) ? null : notice;
}

export type TryFailureKind = 'invalid' | 'refUnreadable' | 'appFileMissing' | 'noMemory' | 'modelError' | 'other';

const MODEL_ERRORS = new Set(['MODEL_LOAD_FAILED', 'MODEL_WORKER_CRASHED', 'MODEL_OUTPUT_INVALID', 'MODEL_UNAVAILABLE']);

/** 试用失败的错误码（提交被拒时是 `details.code`，任务失败时是 `error.code`）→ 哪一类。 */
export function tryFailureKind(code: string | null, details: unknown): TryFailureKind {
  if (code === 'INPUT_UNREADABLE' || code === 'ASSET_MISSING') return 'refUnreadable';
  if (code === 'APP_FILE_MISSING') return 'appFileMissing';
  if (code === 'RESOURCE_ADMISSION_UNSATISFIABLE') return 'noMemory';
  if (code === 'MODEL_LOAD_FAILED' && asRecord(details).reason === 'resource') return 'noMemory';
  if (code && MODEL_ERRORS.has(code)) return 'modelError';
  return 'other';
}

/** 文件名：路径的最后一段（两种分隔符都认）。 */
export function fileLabel(file: unknown): string | null {
  if (typeof file !== 'string' || !file) return null;
  return file.split(/[\\/]/).filter(Boolean).pop() ?? null;
}

export interface TryFailureInput {
  kind: TryFailureKind;
  /** 表单没填好时那一条；Runtime 的原话（`other`）。 */
  message?: string | null;
  /** 读不出的录音：用户选的文件名，或 `details.file`。 */
  file?: string | null;
  /** 这次提交被拒（没开始），而不是任务失败。 */
  notStarted?: boolean;
  /** 行上能检查。 */
  canCheck: boolean;
  /** 试听（默认）还是试画。 */
  subject?: TrySubject;
}

/** 试用自己的失败：哪里不对 + 怎么办 + 有动作就给按钮；不弹 toast。 */
export function tryFailureView(input: TryFailureInput): TryNoteView {
  const subject = input.subject ?? TRY_SUBJECT;
  switch (input.kind) {
    case 'invalid':
      return { text: input.message ?? '', todo: null, actions: [] };
    case 'refUnreadable': {
      const s = TRY_FAILURE.refUnreadable(fileLabel(input.file) ?? TRY_FAILURE.refUnknown);
      return {
        text: sentence(s.text),
        todo: s.todo,
        actions: [
          { k: 'pickRef', label: CHECK_LABEL.pickRef, primary: true },
          { k: 'useSample', label: CHECK_LABEL.useSample },
        ],
      };
    }
    case 'appFileMissing': {
      const s = TRY_FAILURE.appFileMissing;
      return { text: sentence(s.text), todo: s.todo, actions: [] };
    }
    case 'noMemory': {
      const s = subject.noMemory;
      return { text: sentence(s.text), todo: s.todo, actions: [{ k: 'retry', label: CHECK_LABEL.retry, primary: true }] };
    }
    case 'modelError': {
      const actions: TryAction[] = input.canCheck ? [{ k: 'check', label: CHECK_LABEL.checkFull, primary: true }] : [];
      actions.push({ k: 'retry', label: CHECK_LABEL.retry, primary: !input.canCheck });
      const s = subject.modelError;
      return { text: sentence(s.text), todo: s.todo, actions };
    }
    case 'other': {
      const message = input.message ?? '';
      const s = input.notStarted ? subject.notStarted(message) : subject.other(message);
      return { text: s.todo ? sentence(s.text) : s.text, todo: s.todo || null, actions: [{ k: 'retry', label: CHECK_LABEL.retry }] };
    }
  }
}
