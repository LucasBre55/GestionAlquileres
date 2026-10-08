const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Returns DATABASE_URL_TEST, refusing anything that is not a local database.
 * Tests truncate every table, so pointing them at Neon by mistake must fail loudly.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Add it to .env.local (see .env.example).',
    );
  }

  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `DATABASE_URL_TEST must point to a local database, got host "${hostname}".`,
    );
  }

  return url;
}
