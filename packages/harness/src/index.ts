export * from './driver.ts';
export * from './logger.ts';
export { TopicLog, type TopicSubscription } from './topic-log.ts';
export { ConversationState } from './conversation-state.ts';
export { contextBlock, escapeContextTags } from './context-tags.ts';
export { projectAgentEvent, finishTask, type RunContext, type ProjectionSignal } from './projector.ts';
export { AgentManager, DriverRegistry } from './agent-manager.ts';
export {
  Harness,
  driverApprovalRisk,
  projectMissingError,
  withEditorContext,
  withSpaceReferences,
  withSlideAnnotations,
  withDesignAnnotations,
  withDesignSystemAnnotations,
  withVideoAnnotations,
  type ResolvedSlideAnnotation,
  type ResolvedDesignAnnotation,
  type ResolvedDesignSystemAnnotation,
  type ResolvedVideoAnnotation,
  withDocsAnnotations,
  type ResolvedDocsAnnotation,
  type HarnessAttachments,
  type ContractActor,
  type ConversationProjectTarget,
  type HarnessOptions,
  type ToolCallApproval,
  type ToolCallApprovalRequest,
} from './harness.ts';
export { ApprovalService, type ApprovalRequestInput, type ApprovalResolution, type ApprovalServiceEvent } from './approval-service.ts';
export { NO_TASK_BUDGET, buildContract, engineProtections, type TaskBudgetPort } from './task-contracts.ts';
