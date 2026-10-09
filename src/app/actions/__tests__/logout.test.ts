import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteSessionCookie: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/db', async () => {
  const { sesiones } = await import('@/db/schema')
  return {
    db: {
      update: (table: unknown) => {
        expect(table).toBe(sesiones)
        return {
          set: (values: unknown) => {
            mocks.updateSet(values)
            return { where: mocks.updateWhere }
          },
        }
      },
    },
  }
})
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({
  getSession: mocks.getSession,
  deleteSessionCookie: mocks.deleteSessionCookie,
}))

import { logoutAction } from '@/app/actions/logout'
import { hashSessionId } from '@/lib/session-id'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateWhere.mockResolvedValue(undefined)
  mocks.deleteSessionCookie.mockResolvedValue(undefined)
})

describe('logoutAction', () => {
  it('marks the current session as revoked with revoked_at = now', async () => {
    mocks.getSession.mockResolvedValue({ userId: 1, email: 'a@b.c', sessionId: 'sid' })
    const before = Date.now()

    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

    expect(mocks.updateSet).toHaveBeenCalledTimes(1)
    const [values] = mocks.updateSet.mock.calls[0]
    expect(values.revokedAt).toBeInstanceOf(Date)
    expect(values.revokedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(values.revokedAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1)
  })

  it('revokes before deleting the cookie, then redirects to /login', async () => {
    mocks.getSession.mockResolvedValue({ userId: 1, email: 'a@b.c', sessionId: 'sid' })

    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

    expect(mocks.updateWhere.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSessionCookie.mock.invocationCallOrder[0]
    )
    expect(mocks.redirect).toHaveBeenCalledWith('/login')
  })

  it('only deletes the cookie when there is no valid session', async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

    expect(mocks.updateSet).not.toHaveBeenCalled()
    expect(mocks.deleteSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('only deletes the cookie for a token issued before sessions existed', async () => {
    mocks.getSession.mockResolvedValue({ userId: 1, email: 'a@b.c' })

    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

    expect(mocks.updateSet).not.toHaveBeenCalled()
    expect(mocks.deleteSessionCookie).toHaveBeenCalledTimes(1)
  })

  describe('when revoking the session fails', () => {
    const RAW_SESSION_ID = 'raw-session-id-que-no-debe-loguearse'

    beforeEach(() => {
      mocks.getSession.mockResolvedValue({
        userId: 1,
        email: 'a@b.c',
        sessionId: RAW_SESSION_ID,
      })
      mocks.updateWhere.mockRejectedValue(new Error('db down'))
    })

    it('still deletes the cookie and redirects to /login instead of throwing', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

      expect(mocks.deleteSessionCookie).toHaveBeenCalledTimes(1)
      expect(mocks.redirect).toHaveBeenCalledWith('/login')
      consoleError.mockRestore()
    })

    it('logs the hash of the session id and the error message, never the raw id', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

      expect(consoleError).toHaveBeenCalledTimes(1)
      const logged = JSON.stringify(consoleError.mock.calls[0])
      expect(logged).toContain(hashSessionId(RAW_SESSION_ID))
      expect(logged).toContain('db down')
      expect(logged).not.toContain(RAW_SESSION_ID)
      consoleError.mockRestore()
    })

    it('does not log anything when the revocation succeeds', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.updateWhere.mockResolvedValue(undefined)

      await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login')

      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})
