import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  compare: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ where: mocks.findUsers }) }) },
}))
vi.mock('bcryptjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bcryptjs')>()),
  compare: mocks.compare,
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({
  createSessionToken: vi.fn().mockResolvedValue('token'),
  createSessionCookie: vi.fn().mockResolvedValue(undefined),
}))

import { loginAction } from '@/app/actions/auth'

const USER_HASH = '$2b$12$userhashuserhashuserhashuserhashuserhashuserhashuserha'
const initialState = { success: false, error: '' }

function loginForm(email: string, password: string) {
  const formData = new FormData()
  formData.set('email', email)
  formData.set('password', password)
  return formData
}

describe('loginAction timing-attack mitigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('compares exactly once against a dummy hash when the user does not exist', async () => {
    mocks.findUsers.mockResolvedValue([])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('nadie@example.com', 'whatever')
    )

    expect(result).toEqual({ success: false, error: 'Credenciales inválidas' })
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

    expect(result).toEqual({ success: false, error: 'Credenciales inválidas' })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('compares exactly once against the real hash when the password is wrong', async () => {
    mocks.findUsers.mockResolvedValue([
      { id: 1, email: 'dueno@example.com', passwordHash: USER_HASH },
    ])
    mocks.compare.mockResolvedValue(false)

    const result = await loginAction(
      initialState,
      loginForm('dueno@example.com', 'incorrecta')
    )

    expect(result).toEqual({ success: false, error: 'Credenciales inválidas' })
    expect(mocks.compare).toHaveBeenCalledTimes(1)
    expect(mocks.compare).toHaveBeenCalledWith('incorrecta', USER_HASH)
  })

  it('compares exactly once and redirects when the credentials are valid', async () => {
    mocks.findUsers.mockResolvedValue([
      { id: 1, email: 'dueno@example.com', passwordHash: USER_HASH },
    ])
    mocks.compare.mockResolvedValue(true)

    await expect(
      loginAction(initialState, loginForm('dueno@example.com', 'correcta'))
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard')

    expect(mocks.compare).toHaveBeenCalledTimes(1)
    expect(mocks.compare).toHaveBeenCalledWith('correcta', USER_HASH)
  })
})
