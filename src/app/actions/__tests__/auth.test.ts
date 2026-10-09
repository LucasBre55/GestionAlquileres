import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  findAttempts: vi.fn(),
  insertAttempt: vi.fn(),
  insertSession: vi.fn(),
  deleteAttempts: vi.fn(),
  createSessionToken: vi.fn(),
  createSessionCookie: vi.fn(),
  compare: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/db', async () => {
  const { intentosLogin, sesiones } = await import('@/db/schema')
  return {
    db: {
      // La acción lee y escribe tablas con la misma forma: se distinguen por tabla
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            table === intentosLogin ? mocks.findAttempts() : mocks.findUsers(),
        }),
      }),
      insert: (table: unknown) => ({
        values: table === sesiones ? mocks.insertSession : mocks.insertAttempt,
      }),
      delete: () => ({ where: mocks.deleteAttempts }),
    },
  }
})
vi.mock('bcryptjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bcryptjs')>()),
  compare: mocks.compare,
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({
  createSessionToken: mocks.createSessionToken,
  createSessionCookie: mocks.createSessionCookie,
}))

import { loginAction } from '@/app/actions/auth'
import { hashSessionId } from '@/lib/session-id'

const USER_HASH = '$2b$12$userhashuserhashuserhashuserhashuserhashuserhashuserha'
const initialState = { success: false, error: '' }
const INVALID = { success: false, error: 'Credenciales inválidas' }
const RATE_LIMITED = {
  success: false,
  error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.',
}

function loginForm(email: string, password: string) {
  const formData = new FormData()
  formData.set('email', email)
  formData.set('password', password)
  return formData
}

const existingUser = { id: 1, email: 'dueno@example.com', passwordHash: USER_HASH }

// Timestamps de "ahora": caen dentro de cualquier ventana de 15 minutos
const recentAttempts = (count: number) =>
  Array.from({ length: count }, () => ({ creadoEn: new Date() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findAttempts.mockResolvedValue([])
  mocks.createSessionToken.mockResolvedValue('token')
  mocks.createSessionCookie.mockResolvedValue(undefined)
})

describe('loginAction timing-attack mitigation', () => {
  it('compares exactly once against a dummy hash when the user does not exist', async () => {
    mocks.findUsers.mockResolvedValue([])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('nadie@example.com', 'whatever')
    )

    expect(result).toEqual(INVALID)
    expect(mocks.compare).toHaveBeenCalledTimes(1)
    const [, hashUsed] = mocks.compare.mock.calls[0]
    expect(hashUsed).toMatch(/^\$2[aby]\$12\$/)
    expect(hashUsed).not.toBe(USER_HASH)
  })

  it('never lets the dummy hash authenticate, even if compare says true', async () => {
    mocks.findUsers.mockResolvedValue([])
    mocks.compare.mockResolvedValue(true)

    const result = await loginAction(
      initialState,
      loginForm('nadie@example.com', 'whatever')
    )

    expect(result).toEqual(INVALID)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('compares exactly once against the real hash when the password is wrong', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('dueno@example.com', 'incorrecta')
    )

    expect(result).toEqual(INVALID)
    expect(mocks.compare).toHaveBeenCalledTimes(1)
    expect(mocks.compare).toHaveBeenCalledWith('incorrecta', USER_HASH)
  })

  it('compares exactly once and redirects when the credentials are valid', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(true)

    await expect(
      loginAction(initialState, loginForm('dueno@example.com', 'correcta'))
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard')

    expect(mocks.compare).toHaveBeenCalledTimes(1)
    expect(mocks.compare).toHaveBeenCalledWith('correcta', USER_HASH)
  })
})

describe('loginAction rate limiting', () => {
  it('blocks at 5 recent attempts without touching bcrypt, for an existing user', async () => {
    mocks.findAttempts.mockResolvedValue(recentAttempts(5))
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(true)

    const result = await loginAction(
      initialState,
      loginForm('dueno@example.com', 'correcta')
    )

    expect(result).toEqual(RATE_LIMITED)
    expect(mocks.compare).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.insertAttempt).not.toHaveBeenCalled()
  })

  it('blocks identically for an email that does not exist', async () => {
    mocks.findAttempts.mockResolvedValue(recentAttempts(5))
    mocks.findUsers.mockResolvedValue([])

    const result = await loginAction(
      initialState,
      loginForm('nadie@example.com', 'whatever')
    )

    expect(result).toEqual(RATE_LIMITED)
    expect(mocks.compare).not.toHaveBeenCalled()
  })

  it('still processes the login with 4 recent attempts', async () => {
    mocks.findAttempts.mockResolvedValue(recentAttempts(4))
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('dueno@example.com', 'incorrecta')
    )

    expect(result).toEqual(INVALID)
    expect(mocks.compare).toHaveBeenCalledTimes(1)
  })

  it('does not count attempts older than the window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000)
    mocks.findAttempts.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ creadoEn: old }))
    )
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('dueno@example.com', 'incorrecta')
    )

    expect(result).toEqual(INVALID)
  })

  it('records a failed attempt when the user does not exist', async () => {
    mocks.findUsers.mockResolvedValue([])
    mocks.compare.mockResolvedValue(false)

    await loginAction(initialState, loginForm('  Nadie@Example.com ', 'whatever'))

    expect(mocks.insertAttempt).toHaveBeenCalledTimes(1)
    // Email normalizado, el mismo valor que se usa en la búsqueda
    expect(mocks.insertAttempt).toHaveBeenCalledWith({ email: 'nadie@example.com' })
  })

  it('records a failed attempt when the password is wrong', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    await loginAction(initialState, loginForm('dueno@example.com', 'incorrecta'))

    expect(mocks.insertAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.insertAttempt).toHaveBeenCalledWith({ email: 'dueno@example.com' })
  })

  it('clears the attempts and does not record one on a successful login', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(true)

    await expect(
      loginAction(initialState, loginForm('dueno@example.com', 'correcta'))
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard')

    expect(mocks.deleteAttempts).toHaveBeenCalledTimes(1)
    expect(mocks.insertAttempt).not.toHaveBeenCalled()
  })

  it('does not clear the attempts on a failed login', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    await loginAction(initialState, loginForm('dueno@example.com', 'incorrecta'))

    expect(mocks.deleteAttempts).not.toHaveBeenCalled()
  })
})

describe('loginAction session persistence', () => {
  async function successfulLogin() {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(true)
    await expect(
      loginAction(initialState, loginForm('dueno@example.com', 'correcta'))
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard')
  }

  it('puts a random session id in the JWT payload', async () => {
    await successfulLogin()

    expect(mocks.createSessionToken).toHaveBeenCalledTimes(1)
    const [payload] = mocks.createSessionToken.mock.calls[0]
    expect(payload).toMatchObject({ userId: 1, email: 'dueno@example.com' })
    expect(payload.sessionId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('inserts a session row with the SHA-256 hash of the id, never the id itself', async () => {
    await successfulLogin()

    const [{ sessionId }] = mocks.createSessionToken.mock.calls[0]
    expect(mocks.insertSession).toHaveBeenCalledTimes(1)
    const [row] = mocks.insertSession.mock.calls[0]
    expect(row.usuarioId).toBe(1)
    expect(row.tokenHash).toBe(hashSessionId(sessionId))
    expect(row.revokedAt).toBeNull()
    expect(JSON.stringify(row)).not.toContain(sessionId)
  })

  it('stores created_at = now and expires_at = now + 7 days', async () => {
    await successfulLogin()

    const [row] = mocks.insertSession.mock.calls[0]
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000
    )
  })

  it('persists the session before setting the cookie', async () => {
    await successfulLogin()

    expect(mocks.insertSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSessionCookie.mock.invocationCallOrder[0]
    )
  })

  it('issues a different session id on every login', async () => {
    await successfulLogin()
    await successfulLogin()

    const ids = mocks.createSessionToken.mock.calls.map(([p]) => p.sessionId)
    expect(new Set(ids).size).toBe(2)
  })

  it('does not create a session when the login fails', async () => {
    mocks.findUsers.mockResolvedValue([existingUser])
    mocks.compare.mockResolvedValue(false)

    await loginAction(initialState, loginForm('dueno@example.com', 'incorrecta'))

    expect(mocks.insertSession).not.toHaveBeenCalled()
    expect(mocks.createSessionToken).not.toHaveBeenCalled()
  })

  it('does not create a session when rate limited', async () => {
    mocks.findAttempts.mockResolvedValue(recentAttempts(5))

    await loginAction(initialState, loginForm('dueno@example.com', 'correcta'))

    expect(mocks.insertSession).not.toHaveBeenCalled()
  })
})
