import { describe, expect, it } from 'vitest'
import {
  SESSION_DURATION_DAYS,
  generateSessionId,
  getSessionExpiresAt,
  hashSessionId,
} from '@/lib/session-id'

describe('hashSessionId', () => {
  it('is deterministic: the same input always gives the same output', () => {
    expect(hashSessionId('abc')).toBe(hashSessionId('abc'))
  })

  it('returns the known SHA-256 hex digest', () => {
    expect(hashSessionId('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('gives different outputs for different inputs', () => {
    expect(hashSessionId('abc')).not.toBe(hashSessionId('abd'))
  })

  it('never returns the identifier itself', () => {
    const sessionId = generateSessionId()
    expect(hashSessionId(sessionId)).not.toContain(sessionId)
    expect(hashSessionId(sessionId)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('generateSessionId', () => {
  it('returns a different high-entropy identifier each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSessionId()))
    expect(ids.size).toBe(50)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('getSessionExpiresAt', () => {
  it('is exactly 7 days after now', () => {
    const now = new Date('2026-10-08T12:00:00.000Z')
    expect(SESSION_DURATION_DAYS).toBe(7)
    expect(getSessionExpiresAt(now)).toEqual(new Date('2026-10-15T12:00:00.000Z'))
  })
})
