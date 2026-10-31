import type { AiConfig } from '../../config/ai-env';
import type { InsightsRepository } from '../insights/insights.repository';
import type { AiRepository } from './ai.repository';
import type { AiProvider } from './provider/ai-provider';

export interface AiModuleDependencies {
  repository: AiRepository;
  provider: AiProvider;
  config: Pick<AiConfig, 'enabled' | 'rateLimit'>;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface InsightsModuleDependencies {
  repository: InsightsRepository;
}
