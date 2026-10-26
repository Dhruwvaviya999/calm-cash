/**
 * Guards destructive test setup: returns the URL only when it names a dedicated `*_test` database
 * that differs from the development database, and throws a clear error otherwise.
 */
export function assertDisposableDatabaseUrl(
  testUrl: string | undefined,
  developmentUrl: string | undefined,
): string {
  if (testUrl === undefined || testUrl.trim() === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need a dedicated database, e.g. ' +
        'postgresql://calmcash:<password>@localhost:5433/calmcash_test (see .env.example).',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL.');
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_URL must name a database ending in "_test"; its tables are wiped by the tests.',
    );
  }
  if (developmentUrl?.trim() === testUrl.trim()) {
    throw new Error('TEST_DATABASE_URL must not be the same database as DATABASE_URL.');
  }
  return testUrl;
}
