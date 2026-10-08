import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const zhHant: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `沒有名為「${p.name}」的固定流程`,
  entryTargetUnsupported: '這個 Runtime 無法從 Space 條目開啟影片',
  targetMismatch: '參數 target 與 videoId 指向不同的影片',
  noLibrary: '這個 Runtime 沒有使用者資料庫',
  notPipeline: '這個任務不是固定流程',
  notRetryable: '只有失敗、已取消或已中斷的固定流程可以重試',
  pipelineMissing: (p: { name: string }) => `這個 Runtime 沒有名為「${p.name}」的固定流程`,
  alreadyRetrying: '固定流程已在重試中',
  cannotOpenTarget: '這個 Runtime 無法開啟固定流程的目標影片',
  targetReplaced: '目標位置上現在是另一部影片。請重新開始。',
  pipelineFailed: '固定流程發生錯誤',
  stepFailed: '步驟發生錯誤',
  interrupted: 'Runtime 在固定流程完成前停止。請使用 pipelines.retry 從停下的步驟繼續。',
  subtask: (p: { step: string; label: string }) => `${p.step}：${p.label}`,
};
