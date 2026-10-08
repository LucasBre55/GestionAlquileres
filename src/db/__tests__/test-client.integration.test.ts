import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { usuarios } from '../schema';
import { testDb } from '../test-client';

describe('test database', () => {
  it('persists and reads back an inserted user', async () => {
    await testDb.insert(usuarios).values({
      nombre: 'Test User',
      email: 'test@example.com',
      passwordHash: 'not-a-real-hash',
    });

    const rows = await testDb
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, 'test@example.com'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, nombre: 'Test User' });
  });

  it('starts empty because the previous test was truncated', async () => {
    const rows = await testDb.select().from(usuarios);

    expect(rows).toHaveLength(0);
  });
});
