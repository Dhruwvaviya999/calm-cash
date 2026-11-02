// Public surface of the shared AI feature: availability, presentation, and settings.
export {
  assistantHref,
  describeAiProblem,
  describeAiStatus,
  SUGGESTED_QUESTIONS,
  type AppHref,
} from './ai-presentation';
export { AiPrivacySettings } from './components/ai-privacy-settings';
export {
  AssistantBlocks,
  type AssistantBlocksProps,
  type ReferenceNames,
} from './components/assistant-blocks';
export { invalidateAiStatus, useAiStatus } from './use-ai-status';
