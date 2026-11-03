import {
  categorySuggestionInputSchema,
  type ApiSuccessResponse,
  dismissSuggestionInputSchema,
  entityIdSchema,
  explainInsightInputSchema,
  intelligenceExplanationInputSchema,
  financialReportInputSchema,
  merchantRuleInputSchema,
  rejectSuggestionInputSchema,
  renameConversationInputSchema,
  searchInterpretationInputSchema,
  sendMessageInputSchema,
  transactionDraftInputSchema,
  updateAiPreferencesInputSchema,
} from '@calmcash/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../../lib/app-error';
import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { sendSuccess } from '../../lib/http-response';
import { validateRequest } from '../../middleware/validate-request';
import type { AiService } from './ai.service';

export interface AiRateRule {
  limit: number;
  windowMs: number;
}

/** The response type of a service call (annotated where a rate limiter precedes the handler). */
type Reply<K extends keyof AiService> = Response<
  ApiSuccessResponse<Awaited<ReturnType<AiService[K]>>>
>;

const conversationParams = z.object({ conversationId: entityIdSchema });
const noQuery = z.object({ query: z.strictObject({}) });

const entrySuggestionSchema = z.strictObject({
  type: z.enum(['income', 'expense']),
  description: z.string().trim().min(2).max(255),
  merchant: z.string().trim().min(1).max(120).exactOptional(),
});

/** Model-backed requests per signed-in user (in memory, like the other per-user limits). */
function aiRateLimit(rule: AiRateRule, userIdOf: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `ai:${userIdOf(req)}`,
    handler: (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'You have asked the assistant a lot recently. Please wait a few minutes.',
        ),
      );
    },
  });
}

/**
 * AI features. Every route requires a session; changes require the CSRF token; responses are
 * `no-store`. The owner always comes from the session. Requests that reach the model are rate
 * limited per user. Nothing here creates or changes a transaction, account, budget, or schedule:
 * drafts and suggestions are applied by the web app through the ordinary endpoints.
 *
 * GET    /status                          provider reachability, model, the person's switch
 * GET    /preferences · PATCH            the person's AI switch
 * GET    /conversations · POST · DELETE  list, start, clear all
 * GET    /conversations/:id · PATCH · DELETE
 * POST   /conversations/:id/messages     ask a question (model)
 * POST   /transaction-drafts             a draft from a sentence (model)
 * POST   /category-suggestions           for up to 10 transactions (history, then model)
 * POST   /category-suggestions/entry     for a transaction being entered
 * POST   /category-suggestions/reject    do not suggest this category for it again
 * GET    /merchant-suggestions           readable merchants for recent transactions
 * POST   /merchant-suggestions/dismiss
 * GET    /merchant-rules · POST · DELETE /merchant-rules/:id
 * POST   /search-interpretations         filters from a question (model)
 * POST   /reports                        an on-demand report
 * POST   /insight-explanations           plain words for one insight
 * POST   /intelligence-explanations      plain words for a forecast, projection, or scenario
 */
export function createAiRouter(service: AiService, auth: AuthBoundary, rule: AiRateRule): Router {
  const router = Router();
  const limit = aiRateLimit(rule, (req) => auth.getCaller(req).userId);
  router.use(auth.requireSession, auth.requireCsrf, noStore);
  const caller = (req: object): ReturnType<AuthBoundary['getCaller']> => auth.getCaller(req);

  router.get(
    '/status',
    validateRequest(noQuery, async (_input, req, res) => {
      sendSuccess(res, await service.status(caller(req)));
    }),
  );
  router.get(
    '/preferences',
    validateRequest(noQuery, async (_input, req, res) => {
      sendSuccess(res, await service.preferences(caller(req)));
    }),
  );
  router.patch(
    '/preferences',
    validateRequest(
      z.object({ body: updateAiPreferencesInputSchema }),
      async ({ body }, req, res) => {
        sendSuccess(res, await service.updatePreferences(caller(req), body.enabled));
      },
    ),
  );

  router.get(
    '/conversations',
    validateRequest(noQuery, async (_input, req, res) => {
      sendSuccess(res, await service.conversations(caller(req)));
    }),
  );
  router.post(
    '/conversations',
    validateRequest(z.object({}), async (_input, req, res) => {
      sendSuccess(res, await service.createConversation(caller(req)), 201);
    }),
  );
  router.delete(
    '/conversations',
    validateRequest(noQuery, async (_input, req, res) => {
      sendSuccess(res, { deleted: await service.clearConversations(caller(req)) });
    }),
  );
  router.get(
    '/conversations/:conversationId',
    validateRequest(z.object({ params: conversationParams }), async ({ params }, req, res) => {
      sendSuccess(res, await service.conversation(caller(req), params.conversationId));
    }),
  );
  router.patch(
    '/conversations/:conversationId',
    validateRequest(
      z.object({ params: conversationParams, body: renameConversationInputSchema }),
      async ({ params, body }, req, res) => {
        sendSuccess(
          res,
          await service.renameConversation(caller(req), params.conversationId, body.title),
        );
      },
    ),
  );
  router.delete(
    '/conversations/:conversationId',
    validateRequest(z.object({ params: conversationParams }), async ({ params }, req, res) => {
      await service.deleteConversation(caller(req), params.conversationId);
      sendSuccess(res, { deleted: 1 });
    }),
  );
  router.post(
    '/conversations/:conversationId/messages',
    limit,
    validateRequest(
      z.object({ params: conversationParams, body: sendMessageInputSchema }),
      async ({ params, body }, req, res: Reply<'sendMessage'>) => {
        sendSuccess(
          res,
          await service.sendMessage(caller(req), params.conversationId, body.content),
          201,
        );
      },
    ),
  );

  router.post(
    '/transaction-drafts',
    limit,
    validateRequest(
      z.object({ body: transactionDraftInputSchema }),
      async ({ body }, req, res: Reply<'draft'>) => {
        sendSuccess(res, await service.draft(caller(req), body.text));
      },
    ),
  );

  router.post(
    '/category-suggestions',
    limit,
    validateRequest(
      z.object({ body: categorySuggestionInputSchema }),
      async ({ body }, req, res: Reply<'categorySuggestions'>) => {
        sendSuccess(res, await service.categorySuggestions(caller(req), body.transactionIds));
      },
    ),
  );
  router.post(
    '/category-suggestions/entry',
    limit,
    validateRequest(
      z.object({ body: entrySuggestionSchema }),
      async ({ body }, req, res: Reply<'entryCategorySuggestion'>) => {
        sendSuccess(res, await service.entryCategorySuggestion(caller(req), body));
      },
    ),
  );
  router.post(
    '/category-suggestions/reject',
    validateRequest(z.object({ body: rejectSuggestionInputSchema }), async ({ body }, req, res) => {
      await service.rejectCategory(caller(req), body.transactionId, body.categoryId);
      sendSuccess(res, { rejected: true });
    }),
  );

  router.get(
    '/merchant-suggestions',
    limit,
    validateRequest(noQuery, async (_input, req, res: Reply<'merchantSuggestions'>) => {
      sendSuccess(res, await service.merchantSuggestions(caller(req)));
    }),
  );
  router.post(
    '/merchant-suggestions/dismiss',
    validateRequest(
      z.object({ body: dismissSuggestionInputSchema }),
      async ({ body }, req, res) => {
        await service.dismissMerchant(caller(req), body.transactionId);
        sendSuccess(res, { dismissed: true });
      },
    ),
  );
  router.get(
    '/merchant-rules',
    validateRequest(noQuery, async (_input, req, res) => {
      sendSuccess(res, { items: await service.merchantRules(caller(req)) });
    }),
  );
  router.post(
    '/merchant-rules',
    validateRequest(z.object({ body: merchantRuleInputSchema }), async ({ body }, req, res) => {
      sendSuccess(
        res,
        await service.saveMerchantRule(caller(req), body.patternKey, body.merchant),
        201,
      );
    }),
  );
  router.delete(
    '/merchant-rules/:ruleId',
    validateRequest(
      z.object({ params: z.object({ ruleId: entityIdSchema }) }),
      async ({ params }, req, res) => {
        await service.deleteMerchantRule(caller(req), params.ruleId);
        sendSuccess(res, { deleted: 1 });
      },
    ),
  );

  router.post(
    '/search-interpretations',
    limit,
    validateRequest(
      z.object({ body: searchInterpretationInputSchema }),
      async ({ body }, req, res: Reply<'interpretSearch'>) => {
        sendSuccess(res, await service.interpretSearch(caller(req), body.query));
      },
    ),
  );
  router.post(
    '/reports',
    limit,
    validateRequest(
      z.object({ body: financialReportInputSchema }),
      async ({ body }, req, res: Reply<'report'>) => {
        sendSuccess(res, await service.report(caller(req), body));
      },
    ),
  );
  router.post(
    '/insight-explanations',
    limit,
    validateRequest(
      z.object({ body: explainInsightInputSchema }),
      async ({ body }, req, res: Reply<'explainInsight'>) => {
        sendSuccess(res, await service.explainInsight(caller(req), body));
      },
    ),
  );
  router.post(
    '/intelligence-explanations',
    limit,
    validateRequest(
      z.object({ body: intelligenceExplanationInputSchema }),
      async ({ body }, req, res: Reply<'explainIntelligence'>) => {
        sendSuccess(res, await service.explainIntelligence(caller(req), body));
      },
    ),
  );

  return router;
}
