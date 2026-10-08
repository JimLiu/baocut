import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const zhHans: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `没有固定流程「${p.name}」`,
  entryTargetUnsupported: '这个 Runtime 不能按 Space 条目打开视频',
  targetMismatch: '参数 target 与 videoId 指的不是同一个视频',
  noLibrary: '这个 Runtime 没有用户库',
  notPipeline: '这个任务不是固定流程',
  notRetryable: '只有失败、被取消或被中断的流程可以重试',
  pipelineMissing: (p: { name: string }) => `这个 Runtime 没有固定流程「${p.name}」`,
  alreadyRetrying: '流程已经在重试',
  cannotOpenTarget: '这个 Runtime 不能打开流程的目标视频',
  targetReplaced: '目标位置上已经不是原来的视频：重新开始一次',
  pipelineFailed: '流程执行出错',
  stepFailed: '步骤执行出错',
  interrupted: 'Runtime 停止时流程没有完成；可以用 pipelines.retry 从停下的那一步继续',
  subtask: (p: { step: string; label: string }) => `${p.step}：${p.label}`,
};
