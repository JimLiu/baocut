import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const ru: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Нет пайплайна с именем «${p.name}"`,
  entryTargetUnsupported: "Этот Runtime не может открыть видео из записей Space",
  targetMismatch: "Параметры target и videoId ссылаются на разные видео",
  noLibrary: "У этого Runtime нет пользовательской библиотеки",
  notPipeline: "Эта задача не является пайплайном",
  notRetryable: "Повторить можно только пайплайны с ошибкой, отменённые или прерванные",
  pipelineMissing: (p: { name: string }) => `У этого Runtime нет пайплайна с именем «${p.name}"`,
  alreadyRetrying: "Повтор пайплайна уже выполняется",
  cannotOpenTarget: "Этот Runtime не может открыть целевое видео пайплайна",
  targetReplaced: "В целевом месте теперь другое видео. Начните заново.",
  pipelineFailed: "В пайплайне произошла ошибка",
  stepFailed: "На шаге произошла ошибка",
  interrupted: "Runtime остановлен до завершения пайплайна. Используйте pipelines.retry, чтобы продолжить с шага остановки.",
  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
