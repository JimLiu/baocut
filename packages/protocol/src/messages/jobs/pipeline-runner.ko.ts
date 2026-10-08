import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const ko: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `“${p.name}” 파이프라인이 없습니다`,
  entryTargetUnsupported: '이 Runtime은 Space 항목에서 영상을 열 수 없습니다',
  targetMismatch: 'target과 videoId 매개변수가 서로 다른 영상을 가리킵니다',
  noLibrary: '이 Runtime에는 사용자 라이브러리가 없습니다',
  notPipeline: '이 작업은 파이프라인이 아닙니다',
  notRetryable: '실패, 취소, 중단된 파이프라인만 다시 시도할 수 있습니다',
  pipelineMissing: (p: { name: string }) => `이 Runtime에는 “${p.name}” 파이프라인이 없습니다`,
  alreadyRetrying: '파이프라인을 이미 다시 시도하는 중입니다',
  cannotOpenTarget: '이 Runtime은 파이프라인의 대상 영상을 열 수 없습니다',
  targetReplaced: '대상 위치에 이제 다른 영상이 있습니다. 처음부터 다시 시작하세요.',
  pipelineFailed: '파이프라인에서 오류가 발생했습니다',
  stepFailed: '단계에서 오류가 발생했습니다',
  interrupted: '파이프라인이 끝나기 전에 Runtime이 중지되었습니다. pipelines.retry로 멈춘 단계부터 이어서 진행하세요.',
  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
