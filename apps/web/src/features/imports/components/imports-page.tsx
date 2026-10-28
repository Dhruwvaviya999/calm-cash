'use client';

import { entityIdSchema } from '@calmcash/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

import { ImportHistory } from './import-history';
import { ImportWizard, parseStep } from './import-wizard';
import { NewImportForm } from './new-import-form';

/**
 * Statement imports: upload a CSV statement, map its columns, review every row (duplicates,
 * matches, classification), import the approved rows, and compare the statement's balances with
 * the ledger. Each import is resumable from its own URL (`?batch=<id>`).
 */
export function ImportsPage(): ReactNode {
  const params = useSearchParams();
  const batch = entityIdSchema.safeParse(params.get('batch'));

  if (batch.success) {
    return (
      <>
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-10">
            <Link href="/imports">
              <ArrowLeft aria-hidden="true" />
              All imports
            </Link>
          </Button>
        </div>
        <ImportWizard
          key={batch.data}
          batchId={batch.data}
          requestedStep={parseStep(params.get('step'))}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Statement imports"
        description="Bring in a bank or card statement as a CSV file. You check every row before anything is recorded."
      />
      <NewImportForm />
      <ImportHistory />
    </>
  );
}
