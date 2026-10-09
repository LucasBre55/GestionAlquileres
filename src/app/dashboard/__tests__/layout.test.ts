import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSessionActive: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/session-store', () => ({ isSessionActive: mocks.isSessionActive }))
vi.mock('@/components/LogoutButton', () => ({ default: () => null }))

import DashboardLayout from '@/app/dashboard/layout'

const session = { userId: 1, email: 'dueno@example.com', sessionId: 'sid' }

// Ruta que limpia la cookie y recién después manda a /login (ver route.ts):
// redirigir directo a /login con una cookie de firma válida haría un loop con el proxy
const EXPIRED_SESSION_PATH = '/api/session/expired'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardLayout session validation', () => {
  it('redirects when the JWT is invalid', async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      `NEXT_REDIRECT:${EXPIRED_SESSION_PATH}`
    )
    expect(mocks.isSessionActive).not.toHaveBeenCalled()
  })

  it('redirects when the session was revoked, expired or does not exist', async () => {
    mocks.getSession.mockResolvedValue(session)
    mocks.isSessionActive.mockResolvedValue(false)

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      `NEXT_REDIRECT:${EXPIRED_SESSION_PATH}`
    )
  })

  it('checks the session id taken from the JWT payload', async () => {
    mocks.getSession.mockResolvedValue(session)
    mocks.isSessionActive.mockResolvedValue(true)

    await DashboardLayout({ children: null })

    expect(mocks.isSessionActive).toHaveBeenCalledWith('sid')
  })

  it('renders when the JWT is valid and the session is active', async () => {
    mocks.getSession.mockResolvedValue(session)
    mocks.isSessionActive.mockResolvedValue(true)

    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
