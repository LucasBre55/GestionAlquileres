import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// session-store usa el cliente de producción (Neon): se redirige al Postgres de test
vi.mock('@/db', async () => {
  const { testDb } = await import('@/db/test-client')
  return { db: testDb }
})

import { sesiones, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'
import { hashSessionId } from '@/lib/session-id'
import {
  createSessionRecord,
  isSessionActive,
  revokeSession,
} from '@/lib/session-store'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const hoursFromNow = (hours: number) =>
  new Date(NOW.getTime() + hours * 60 * 60 * 1000)

let usuarioId: number

beforeEach(async () => {
  const [user] = await testDb
    .insert(usuarios)
    .values({ nombre: 'Dueño', email: 'dueno@example.com', passwordHash: 'x' })
    .returning({ id: usuarios.id })
  usuarioId = user.id
})

describe('createSessionRecord', () => {
  it('stores the SHA-256 hash of the identifier, never the identifier itself', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'plain-session-id', now: NOW })

    const rows = await testDb.select().from(sesiones)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toBe(hashSessionId('plain-session-id'))
    expect(JSON.stringify(rows[0])).not.toContain('plain-session-id')
    expect(rows[0].usuarioId).toBe(usuarioId)
    expect(rows[0].createdAt).toEqual(NOW)
    expect(rows[0].expiresAt).toEqual(new Date('2026-10-15T12:00:00.000Z'))
    expect(rows[0].revokedAt).toBeNull()
  })
})

describe('isSessionActive', () => {
  it('is true for an existing, non-revoked, non-expired session', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    expect(await isSessionActive('sid', hoursFromNow(1))).toBe(true)
  })

  it('is false when no row matches the identifier', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    expect(await isSessionActive('otro', hoursFromNow(1))).toBe(false)
  })

  it('is false once the session expired', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    const expiresAt = new Date('2026-10-15T12:00:00.000Z')
    expect(await isSessionActive('sid', new Date(expiresAt.getTime() - 1))).toBe(true)
    expect(await isSessionActive('sid', expiresAt)).toBe(false)
  })

  it('is false once the session was revoked', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    await revokeSession('sid', hoursFromNow(2))
    expect(await isSessionActive('sid', hoursFromNow(3))).toBe(false)
  })

  it('is false for a missing or empty identifier (tokens issued before this change)', async () => {
    expect(await isSessionActive(undefined, NOW)).toBe(false)
    expect(await isSessionActive('', NOW)).toBe(false)
  })
})

describe('revokeSession', () => {
  it('sets revoked_at only on the matching session', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid-a', now: NOW })
    await createSessionRecord({ usuarioId, sessionId: 'sid-b', now: NOW })

    await revokeSession('sid-a', hoursFromNow(1))

    const [a] = await testDb
      .select()
      .from(sesiones)
      .where(eq(sesiones.tokenHash, hashSessionId('sid-a')))
    const [b] = await testDb
      .select()
      .from(sesiones)
      .where(eq(sesiones.tokenHash, hashSessionId('sid-b')))
    expect(a.revokedAt).toEqual(hoursFromNow(1))
    expect(b.revokedAt).toBeNull()
  })

  it('does not overwrite the revocation time of an already revoked session', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    await revokeSession('sid', hoursFromNow(1))
    await revokeSession('sid', hoursFromNow(5))

    const [row] = await testDb.select().from(sesiones)
    expect(row.revokedAt).toEqual(hoursFromNow(1))
  })
})

describe('sesiones foreign key', () => {
  it('is deleted together with its user (cascade)', async () => {
    await createSessionRecord({ usuarioId, sessionId: 'sid', now: NOW })
    await testDb.delete(usuarios).where(eq(usuarios.id, usuarioId))
    expect(await testDb.select().from(sesiones)).toHaveLength(0)
  })
})
