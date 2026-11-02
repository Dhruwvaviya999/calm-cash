'use client';

import type { AiStatusDto, MerchantRuleDto } from '@calmcash/shared';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  clearConversations,
  deleteMerchantRule,
  listMerchantRules,
  updateAiPreferences,
} from '@/services/ai.service';

import { describeAiStatus } from '../ai-presentation';
import { invalidateAiStatus, useAiStatus } from '../use-ai-status';

type Feedback = { tone: 'success' | 'error'; message: string } | undefined;

const SHARED_WITH_MODEL = [
  'Your question, and up to the last few turns of the same conversation.',
  'Figures and short text CalmCash looked up for that question: amounts, dates, category and account names, and transaction descriptions or merchants.',
  'For drafts and suggestions: the sentence you typed, or the descriptions being sorted.',
];

const NEVER_SHARED = [
  'Passwords, sign-in sessions, cookies, or e-mail settings.',
  'Receipt files or other documents you uploaded.',
  'Your e-mail address, other people’s data, or internal record identifiers.',
];

function StatusSummary({ status, timeZone }: { status: AiStatusDto; timeZone: string }): ReactNode {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        {status.available ? (
          <StatusBadge tone="positive">Ready</StatusBadge>
        ) : (
          <StatusBadge tone={status.problem === 'disabled_by_user' ? 'neutral' : 'warning'}>
            Not available
          </StatusBadge>
        )}
        <span className="text-muted-foreground">{describeAiStatus(status)}</span>
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Runs on</dt>
        <dd>Ollama on the CalmCash server — never an outside AI service</dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd className="break-all">
          {status.model}
          {status.modelInstalled === false && ' (not installed yet)'}
        </dd>
        {status.lastSuccessAt !== undefined && (
          <>
            <dt className="text-muted-foreground">Last answered</dt>
            <dd>{formatDateTime(status.lastSuccessAt, timeZone)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function MerchantRules(): ReactNode {
  const rules = useAsyncResource(listMerchantRules);
  const [failure, setFailure] = useState<string | undefined>();

  if (rules.state.status === 'loading') return <ListSkeleton rows={2} />;
  if (rules.state.status === 'error') {
    return (
      <ErrorState
        title="Your merchant rules could not be loaded"
        description={describeRequestError(rules.state.error)}
        onRetry={rules.reload}
      />
    );
  }
  const items: MerchantRuleDto[] = rules.state.data;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Merchant names you taught CalmCash</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet. When you accept a merchant suggestion with “Always use this name”, it appears
          here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{rule.merchant}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  for descriptions starting “{rule.patternKey}”
                </span>
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Forget the rule for ${rule.merchant}`}
                className="size-11 sm:size-8"
                onClick={() =>
                  void (async () => {
                    setFailure(undefined);
                    try {
                      await deleteMerchantRule(rule.id);
                      rules.refresh();
                    } catch (error: unknown) {
                      setFailure(describeRequestError(error));
                    }
                  })()
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failure !== undefined && <p className="text-sm text-expense">{failure}</p>}
    </div>
  );
}

/**
 * Settings → AI & privacy: whether AI features run for this person, what the local model is shown,
 * and controls to remove what the assistant keeps (conversations and merchant rules). Turning AI
 * off never affects records, deterministic insights, or reports.
 */
export function AiPrivacySettings(): ReactNode {
  const { user } = useSignedInSession();
  const status = useAiStatus();
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

  if (status.state.status === 'loading') return <ListSkeleton rows={3} />;
  if (status.state.status === 'error') {
    return (
      <ErrorState
        title="AI settings could not be loaded"
        description={describeRequestError(status.state.error)}
        onRetry={status.reload}
      />
    );
  }
  const current = status.state.data;

  const toggle = async (enabled: boolean): Promise<void> => {
    setSaving(true);
    setFeedback(undefined);
    try {
      await updateAiPreferences(enabled);
      invalidateAiStatus();
      status.refresh();
      setFeedback({
        tone: 'success',
        message: enabled
          ? 'AI features are on.'
          : 'AI features are off. Insights, reports, and everything else keep working.',
      });
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setSaving(false);
    }
  };

  const clearHistory = async (): Promise<void> => {
    setClearing(true);
    setFeedback(undefined);
    try {
      const deleted = await clearConversations();
      setFeedback({
        tone: 'success',
        message:
          deleted === 0
            ? 'There was no assistant history to delete.'
            : `Deleted ${deleted.toString()} ${deleted === 1 ? 'conversation' : 'conversations'}.`,
      });
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <StatusSummary status={current} timeZone={user.timezone} />

      <label
        htmlFor="ai-enabled"
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 has-disabled:cursor-not-allowed has-disabled:opacity-60"
      >
        <input
          id="ai-enabled"
          type="checkbox"
          className="mt-0.5 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
          checked={current.enabledForUser}
          disabled={saving || !current.serverEnabled}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Use AI features
            {saving && (
              <LoaderCircle aria-hidden="true" className="ml-2 inline size-4 animate-spin" />
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            The assistant, transaction drafts, smart search, assistant suggestions, and plain-word
            explanations. Insights and reports keep their figures either way.
            {!current.serverEnabled && ' AI is switched off for this whole CalmCash installation.'}
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">What the local model sees</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {SHARED_WITH_MODEL.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">What it never sees</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {NEVER_SHARED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Every figure in an answer is calculated by CalmCash itself; the model only words it. The
        assistant can never save, move, or change money — drafts and suggestions wait for you.
        Questions and answers are kept in your account until you delete them.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Assistant history</h3>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={clearing}
            onClick={() => {
              setConfirmClear(true);
            }}
          >
            {clearing && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            Delete all conversations
          </Button>
        </div>
        <ConfirmDialog
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title="Delete all assistant conversations?"
          description="Every question and answer is removed for good. Your financial records, insights, and merchant rules are not affected."
          confirmLabel="Delete all"
          destructive
          onConfirm={() => void clearHistory()}
        />
      </div>

      <MerchantRules />

      {feedback !== undefined && (
        <FormMessage tone={feedback.tone === 'success' ? 'success' : 'error'}>
          {feedback.message}
        </FormMessage>
      )}
    </div>
  );
}
