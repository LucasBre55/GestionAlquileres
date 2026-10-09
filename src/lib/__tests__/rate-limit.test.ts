import { describe, expect, it } from 'vitest'
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  getAttemptWindowStart,
  isRateLimited,
} from '@/lib/rate-limit'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000)

describe('login rate limit constants', () => {
  it('allows 5 attempts per 15 minutes', () => {
    expect(LOGIN_MAX_ATTEMPTS).toBe(5)
    expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000)
  })
})

describe('isRateLimited', () => {
  it('allows when there are no attempts', () => {
    expect(isRateLimited([], NOW)).toBe(false)
  })

  it('allows 4 attempts within the window', () => {
    const attempts = [1, 2, 3, 4].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(false)
  })

  it('blocks at 5 attempts within the window', () => {
    const attempts = [1, 2, 3, 4, 5].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(true)
  })

  it('blocks above 5 attempts within the window', () => {
    const attempts = [1, 2, 3, 4, 5, 6, 7].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(true)
  })

  it('ignores attempts older than 15 minutes', () => {
    // 4 recientes + 3 de hace 20 minutos: solo cuentan los 4 recientes
    const attempts = [1, 2, 3, 4, 20, 20, 20].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(false)
  })

  it('does not count an attempt made exactly 15 minutes ago', () => {
    const attempts = [1, 2, 3, 4, 15].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(false)
  })

  it('counts an attempt made just under 15 minutes ago', () => {
    const justInside = new Date(NOW.getTime() - LOGIN_WINDOW_MS + 1)
    const attempts = [minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), justInside]
    expect(isRateLimited(attempts, NOW)).toBe(true)
  })

  it('unblocks once enough attempts fall out of the window', () => {
    const attempts = [1, 2, 3, 4, 10].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(true)
    const later = new Date(NOW.getTime() + 6 * 60 * 1000)
    expect(isRateLimited(attempts, later)).toBe(false)
  })

  it('does not depend on the order of the attempts', () => {
    const attempts = [5, 1, 4, 2, 3].map(minutesAgo)
    expect(isRateLimited(attempts, NOW)).toBe(true)
  })
})

describe('getAttemptWindowStart', () => {
  it('is exactly 15 minutes before now', () => {
    expect(getAttemptWindowStart(NOW)).toEqual(minutesAgo(15))
  })
})
