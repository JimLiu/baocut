import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError, type AiToolSummary, type JobRecord, type TransactionReceipt, type UndoTarget } from '@baocut/protocol';
import { useJobs } from '../../state/jobs-store.ts';
import {
  bindAiToolRun,
  closeAiToolResult,
  resetAiToolRun,
  retryAiTool,
  runKey,
  startAiTool,
  undoAiTool,
  useAiToolRun,
  type AiToolRunDeps,
} from './ai-tool-run.ts';

const context = { paragraphs: 3, characters: 120, chapters: 0, attachments: 0, skippedAttachments: 0, skills: [], references: 0 };
const textSummary: AiToolSummary = {
  videoId: 'vid',
  tool: 'summary',
  providerId: 'openai',
  modelId: 'gpt-5-mini',
  context,
  applied: null,
  text: '# Summary\n\n- point',
  artifactId: 'art_1',
  finishReason: 'stop',
};
const polishSummary: AiToolSummary = { ...textSummary, tool: 'polish', applied: { transactionId: 'tx_apply', changes: 4 }, text: null };

function job(jobId: string, state: JobRecord['state'], summary: AiToolSummary | null = null, extra: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId,
    kind: 'pipeline',
    state,
    phase: state === 'completed' ? 'done' : 'starting',
    progress: null,
    videoId: 'vid',
    updatedAt: 'u1',
    endedAt: state === 'running' || state === 'queued' ? null : 'e1',
    error: null,
    pipeline: {
      name: 'ai-tool',
      params: { videoId: 'vid' },
      steps: [],
      current: null,
      stoppedAt: null,
      summary: state === 'completed' ? (summary as unknown as Record<string, unknown>) : null,
    },
    ...extra,
  } as JobRecord;
}

function fake(start?: () => Promise<string>) {
  const toasts: string[] = [];
  const undone: UndoTarget[] = [];
  let next = 0;
  const deps = {
    runtime: {
      startPipeline: vi.fn(start ?? (async () => `p${++next}`)),
      retryPipeline: vi.fn(async () => {}),
      cancelJob: vi.fn(async () => {}),
      videos: {
        undo: vi.fn(async (target: UndoTarget) => {
          undone.push(target);
          return { transactionId: 'tx_undo', undo: { available: true } } as unknown as TransactionReceipt;
        }),
      },
    },
    toast: (_kind: string, message: string) => {
      toasts.push(message);
    },
  } satisfies AiToolRunDeps;
  bindAiToolRun(deps);
  return { deps, toasts, undone };
}

beforeEach(() => {
  resetAiToolRun();
  useJobs.setState({ ready: true, jobs: [] });
});

afterEach(() => resetAiToolRun());

describe('直接调模型的运行', () => {
  it('提交 ai-tool 流程；只给结果的工具完成时留正文，不写视频', async () => {
    const { deps } = fake();
    const key = runKey('vid', 'summary');
    expect(await startAiTool({ videoId: 'vid', tool: 'summary', prompt: 'Summarize' }, 'gpt-5-mini')).toBe(true);
    expect(deps.runtime.startPipeline).toHaveBeenCalledWith('ai-tool', { videoId: 'vid', tool: 'summary', prompt: 'Summarize' });
    expect(useAiToolRun.getState().runs[key]).toMatchObject({ jobId: 'p1', status: 'running', model: 'gpt-5-mini' });
    // 同一个工具同时只跑一次；别的工具照跑。
    expect(await startAiTool({ videoId: 'vid', tool: 'summary', prompt: 'again' }, 'gpt-5-mini')).toBe(false);
    expect(await startAiTool({ videoId: 'vid', tool: 'blog', prompt: 'Blog' }, 'gpt-5-mini')).toBe(true);
    useJobs.setState({ jobs: [job('p1', 'running')] });
    expect(useAiToolRun.getState().runs[key]).toBeDefined();
    useJobs.setState({ jobs: [job('p1', 'completed', textSummary)] });
    expect(useAiToolRun.getState().runs[key]).toBeUndefined();
    expect(useAiToolRun.getState().results[key]?.summary.text).toBe('# Summary\n\n- point');
    expect(useAiToolRun.getState().receipts[key]).toBeUndefined();
    closeAiToolResult(key);
    expect(useAiToolRun.getState().results[key]).toBeUndefined();
  });

  it('写进视频的工具：收据带那笔事务，撤销一次', async () => {
    const { undone, toasts } = fake();
    const key = runKey('vid', 'polish');
    await startAiTool({ videoId: 'vid', tool: 'polish', prompt: 'Polish' }, 'gpt-5-mini');
    useJobs.setState({ jobs: [job('p1', 'completed', polishSummary)] });
    expect(useAiToolRun.getState().receipts[key]).toMatchObject({ transactionId: 'tx_apply', undone: false });
    await undoAiTool(key);
    expect(undone).toEqual([{ transaction: 'tx_apply' }]);
    expect(useAiToolRun.getState().receipts[key]).toMatchObject({ undone: true, busy: false });
    await undoAiTool(key);
    expect(undone).toHaveLength(1);
    expect(toasts).toEqual([]);
    // 收据关掉之后列表仍知道那一次撤销过。
    closeAiToolResult(key);
    expect(useAiToolRun.getState().undoneJobs).toEqual({ p1: true });
  });

  it('提交被拒（没配文本模型）：问题卡带原因，不留运行', async () => {
    fake(async () => {
      throw new RpcError('invalid-request', 'No text model', { code: 'CAPABILITY_NOT_CONFIGURED' });
    });
    const key = runKey('vid', 'title');
    expect(await startAiTool({ videoId: 'vid', tool: 'title', prompt: 'Titles' }, 'm')).toBe(false);
    expect(useAiToolRun.getState().runs[key]).toBeUndefined();
    expect(useAiToolRun.getState().problems[key]).toMatchObject({ message: 'No text model', retryJobId: null });
  });

  it('失败给原因与重试（同一个任务）；取消只提示', async () => {
    const { deps, toasts } = fake();
    const key = runKey('vid', 'chapters');
    await startAiTool({ videoId: 'vid', tool: 'chapters', prompt: 'Chapters' }, 'gpt-5-mini');
    useJobs.setState({ jobs: [job('p1', 'failed', null, { error: { code: 'MODEL_OUTPUT_INVALID', message: 'bad output' } as JobRecord['error'] })] });
    expect(useAiToolRun.getState().problems[key]).toMatchObject({ message: 'bad output', retryJobId: 'p1', tool: 'chapters' });
    await retryAiTool(key);
    expect(deps.runtime.retryPipeline).toHaveBeenCalledWith('p1');
    // 镜像里还是那条失败的记录：不收尾。
    useJobs.setState({ jobs: [job('p1', 'failed', null, { error: { code: 'X', message: 'x' } as JobRecord['error'] })] });
    expect(useAiToolRun.getState().runs[key]).toBeDefined();
    useJobs.setState({ jobs: [job('p1', 'cancelled', null, { updatedAt: 'u2' })] });
    expect(useAiToolRun.getState().runs[key]).toBeUndefined();
    expect(useAiToolRun.getState().problems[key]).toBeUndefined();
    expect(toasts).toHaveLength(1);
  });
});
