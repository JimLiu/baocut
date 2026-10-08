import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const ja: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `「${p.name}」という固定フローはありません`,
  entryTargetUnsupported: 'この Runtime では Space の項目から動画を開けません',
  targetMismatch: 'パラメータ target と videoId が別々の動画を指しています',
  noLibrary: 'この Runtime にはユーザライブラリがありません',
  notPipeline: 'このタスクは固定フローではありません',
  notRetryable: '再試行できるのは、失敗、キャンセル、または中断された固定フローだけです',
  pipelineMissing: (p: { name: string }) => `この Runtime には「${p.name}」という固定フローがありません`,
  alreadyRetrying: 'この固定フローはすでに再試行中です',
  cannotOpenTarget: 'この Runtime では固定フローの対象の動画を開けません',
  targetReplaced: '対象の場所には別の動画があります。最初からやり直してください。',
  pipelineFailed: '固定フローの実行中にエラーが発生しました',
  stepFailed: '手順の実行中にエラーが発生しました',
  interrupted: '固定フローが完了する前に Runtime が停止しました。pipelines.retry を使うと、停止した手順から続行できます。',
  subtask: (p: { step: string; label: string }) => `${p.step}：${p.label}`,
};
