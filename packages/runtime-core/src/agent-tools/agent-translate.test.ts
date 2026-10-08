import { describe, expect, it } from 'vitest';
import type { Conversation, JobRecord, JobState, SequencedEvent, TasksEvent } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import type { HostedJob, HostedJobControl, JobManager } from '@baocut/jobs';
import type { VideoService } from '../videos/video-service.ts';
import { AgentScope } from './agent-scope.ts';

/**
 * 智能体自己翻译的进度记录（`documents_read` 的 translateTo）：登记、沿用、写入译文时完成、回合结束时收尾。
 * Harness 与 JobManager 用假的：只要 `agentRun`、`conversationOf`、`subscribe` 与 `host`。
 */

const conversation = { id: 'conv_1', cwd: '/tmp/x', projectId: null, driverId: 'codex' } as unknown as Conversation;

function setup() {
  let taskId = 'task_1';
  let listener: ((event: SequencedEvent<unknown>) => void) | null = null;
  const harness = {
    agentRun: () => ({ taskId, stopRequested: false, mode: 'auto', conversation }),
    conversationOf: () => conversation,
    subscribe: (_topic: string, _after: unknown, l: (event: SequencedEvent<unknown>) => void) => {
      listener = l;
      return { result: { mode: 'snapshot' }, unsubscribe: () => {} };
    },
  } as unknown as Harness;
  const hosted: { record: JobRecord; control: HostedJobControl; options: { hosted: string } }[] = [];
  const jobs = {
    host(record: JobRecord, options: { hosted: string; control: HostedJobControl }): HostedJob {
      const entry = { record: structuredClone(record), control: options.control, options };
      hosted.push(entry);
      return {
        jobId: record.jobId,
        record: () => structuredClone(entry.record),
        update: (patch) => Object.assign(entry.record, patch),
        finish: async (state: JobState, patch = {}) => {
          if (!['running', 'queued'].includes(entry.record.state)) return;
          Object.assign(entry.record, { state, endedAt: 'now' }, patch);
        },
      };
    },
  } as unknown as JobManager;
  const scope = new AgentScope({ harness, videos: {} as VideoService, jobs });
  const access = () => scope.authorize({ kind: 'agent', conversationId: conversation.id } as never, true);
  const emit = (event: TasksEvent) => listener?.({ seq: '1' as never, event });
  return {
    scope,
    access,
    hosted,
    emit,
    nextTask: (id: string) => {
      taskId = id;
    },
  };
}

const zh = { videoId: 'video_1', sourceDocumentId: 'doc_speech', language: 'zh-Hans' };

describe('智能体自己翻译的进度记录', () => {
  it('登记一条 agentTranslate 托管记录；同一回合同一范围沿用它', () => {
    const { scope, access, hosted } = setup();
    const jobId = scope.translationStarted(access(), { ...zh, sentences: 42, sourceRevision: '3' });
    expect(jobId).toBeTruthy();
    expect(hosted).toHaveLength(1);
    expect(hosted[0]!.options.hosted).toBe('agent-translate');
    expect(hosted[0]!.record).toMatchObject({
      jobId,
      kind: 'agentTranslate',
      state: 'running',
      phase: 'generating',
      progress: null,
      videoId: 'video_1',
      submitter: { kind: 'agent', id: 'conv_1', taskId: 'task_1' },
      translation: { sourceDocumentId: 'doc_speech', targetLanguage: 'zh-Hans', sentences: 42 },
    });
    expect(scope.translationStarted(access(), { ...zh, sentences: 42 })).toBe(jobId);
    expect(hosted).toHaveLength(1);
    // 另一门语言是另一条。
    expect(scope.translationStarted(access(), { ...zh, language: 'ja', sentences: 42 })).not.toBe(jobId);
    expect(hosted).toHaveLength(2);
  });

  it('写入这门语言的译文时完成，结果指向译文；别的语言不受影响', async () => {
    const { scope, access, hosted } = setup();
    scope.translationStarted(access(), { ...zh, sentences: 3 });
    scope.translationStarted(access(), { ...zh, language: 'ja', sentences: 3 });
    scope.translationWritten(access(), { ...zh, language: 'ZH-hans', documentId: 'doc_tr' });
    await Promise.resolve();
    expect(hosted[0]!.record.state).toBe('completed');
    expect(hosted[0]!.record.result).toEqual({ documentId: 'doc_tr', artifactId: '' });
    expect(hosted[1]!.record.state).toBe('running');
  });

  it('回合结束还没写：用户停止的记为取消，别的记为中断；别的任务结束不动它', async () => {
    const { scope, access, hosted, emit, nextTask } = setup();
    scope.translationStarted(access(), { ...zh, sentences: 3 });
    const task = (taskId: string, status: 'running' | 'completed' | 'stopped') =>
      ({ taskId, status }) as unknown as Extract<TasksEvent, { type: 'task.upsert' }>['task'];
    emit({ type: 'task.upsert', task: task('task_other', 'completed') });
    emit({ type: 'task.upsert', task: task('task_1', 'running') });
    expect(hosted[0]!.record.state).toBe('running');
    emit({ type: 'task.upsert', task: task('task_1', 'stopped') });
    await Promise.resolve();
    expect(hosted[0]!.record.state).toBe('cancelled');

    nextTask('task_2');
    scope.translationStarted(access(), { ...zh, sentences: 3 });
    emit({ type: 'task.upsert', task: task('task_2', 'completed') });
    await Promise.resolve();
    expect(hosted[1]!.record.state).toBe('interrupted');
    // 收尾之后再写入不会改动已经终结的记录。
    scope.translationWritten(access(), { ...zh, documentId: 'doc_tr' });
    expect(hosted[1]!.record.state).toBe('interrupted');
  });

  it('下一个回合接着翻译同一范围：上一回合遗留的记录中断，重新登记', async () => {
    const { scope, access, hosted, nextTask } = setup();
    const first = scope.translationStarted(access(), { ...zh, sentences: 3 });
    nextTask('task_2');
    const second = scope.translationStarted(access(), { ...zh, sentences: 3 });
    await Promise.resolve();
    expect(second).not.toBe(first);
    expect(hosted[0]!.record.state).toBe('interrupted');
    expect(hosted[1]!.record.submitter).toMatchObject({ taskId: 'task_2' });
  });

  it('JobManager 取消或 Runtime 停止：只结束这条记录', async () => {
    const { scope, access, hosted } = setup();
    scope.translationStarted(access(), { ...zh, sentences: 3 });
    hosted[0]!.control.cancel();
    await Promise.resolve();
    expect(hosted[0]!.record.state).toBe('cancelled');
    scope.translationStarted(access(), { ...zh, sentences: 3 });
    hosted[1]!.control.interrupt();
    await Promise.resolve();
    expect(hosted[1]!.record.state).toBe('interrupted');
  });
});
