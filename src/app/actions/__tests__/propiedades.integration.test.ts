import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSessionActive: vi.fn(),
  withTransaction: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/session-store', () => ({ isSessionActive: mocks.isSessionActive }))
vi.mock('@/db/transaction', () => ({ withTransaction: mocks.withTransaction }))

import { crearPropiedadAction } from '@/app/actions/propiedades'
import { ajustesAlquiler, propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'

const initialState = { success: false as const, errors: {} }

function buildFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData()
  const fields: Record<string, string> = {
    inquilinoActual: 'Juan Pérez',
    contactoInquilino: 'juan@example.com',
    direccion: 'Av. Colón 1234, Córdoba',
    montoInicial: '150000.5',
    fechaInicioContrato: '2026-03-01',
    fechaFinContrato: '2028-03-01',
    frecuenciaAumento: '4',
    ...overrides,
  }
  for (const [key, value] of Object.entries(fields)) formData.set(key, value)
  return formData
}

let ownerId: number
let otherUserId: number

beforeEach(async () => {
  vi.clearAllMocks()
  const [owner, other] = await testDb
    .insert(usuarios)
    .values([
      { nombre: 'Dueño', email: 'dueno@example.com', passwordHash: 'x' },
      { nombre: 'Otro', email: 'otro@example.com', passwordHash: 'x' },
    ])
    .returning({ id: usuarios.id })
  ownerId = owner.id
  otherUserId = other.id

  mocks.getSession.mockResolvedValue({ userId: ownerId, email: 'dueno@example.com', sessionId: 'sid' })
  mocks.isSessionActive.mockResolvedValue(true)
  // Production opens a Neon transaction; tests run the same callback on the test database
  mocks.withTransaction.mockImplementation((fn) => testDb.transaction(fn))
})

describe('crearPropiedadAction', () => {
  describe('session', () => {
    it('redirects to /api/session/expired when there is no session', async () => {
      mocks.getSession.mockResolvedValue(null)

      await expect(crearPropiedadAction(initialState, buildFormData())).rejects.toThrow(
        'NEXT_REDIRECT:/api/session/expired'
      )
      expect(mocks.withTransaction).not.toHaveBeenCalled()
      expect(await testDb.select().from(propiedades)).toHaveLength(0)
    })

    it('redirects when the session was revoked or expired', async () => {
      mocks.isSessionActive.mockResolvedValue(false)

      await expect(crearPropiedadAction(initialState, buildFormData())).rejects.toThrow(
        'NEXT_REDIRECT:/api/session/expired'
      )
      expect(mocks.isSessionActive).toHaveBeenCalledWith('sid')
      expect(mocks.withTransaction).not.toHaveBeenCalled()
    })

    it('checks the session before validating the input', async () => {
      mocks.getSession.mockResolvedValue(null)

      await expect(
        crearPropiedadAction(initialState, buildFormData({ direccion: '' }))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
    })
  })

  describe('owner', () => {
    it('uses the owner from the session and ignores a propietarioId sent in the FormData', async () => {
      const result = await crearPropiedadAction(
        initialState,
        buildFormData({ propietarioId: String(otherUserId) })
      )

      expect(result.success).toBe(true)
      const rows = await testDb.select().from(propiedades)
      expect(rows).toHaveLength(1)
      expect(rows[0].propietarioId).toBe(ownerId)
      expect(rows[0].propietarioId).not.toBe(otherUserId)
    })
  })

  describe('success', () => {
    it('creates the property and its initial adjustment and returns the id', async () => {
      const result = await crearPropiedadAction(initialState, buildFormData())

      expect(result.success).toBe(true)
      if (!result.success) return
      const [row] = await testDb.select().from(propiedades)
      expect(result.id).toBe(row.id)
      expect(row.montoInicial).toBe('150000.50')
      expect(row.montoActual).toBe('150000.50')
      const ajustes = await testDb.select().from(ajustesAlquiler)
      expect(ajustes).toHaveLength(1)
      expect(ajustes[0].vigenteDesde).toBe('2026-03-01')
    })

    it('does not redirect', async () => {
      await crearPropiedadAction(initialState, buildFormData())
      expect(mocks.redirect).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns errors per field without opening a transaction', async () => {
      const result = await crearPropiedadAction(
        initialState,
        buildFormData({ direccion: '', montoInicial: '100.555', fechaFinContrato: '2026-02-30' })
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(Object.keys(result.errors).sort()).toEqual([
        'direccion',
        'fechaFinContrato',
        'montoInicial',
      ])
      expect(result.errors.direccion?.[0]).toEqual(expect.any(String))
      expect(mocks.withTransaction).not.toHaveBeenCalled()
      expect(await testDb.select().from(propiedades)).toHaveLength(0)
    })

    it('reports an end date before the start date on fechaFinContrato', async () => {
      const result = await crearPropiedadAction(
        initialState,
        buildFormData({ fechaInicioContrato: '2026-03-01', fechaFinContrato: '2026-01-01' })
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.fechaFinContrato).toBeDefined()
      expect(mocks.withTransaction).not.toHaveBeenCalled()
    })

    it('treats missing fields as validation errors, not crashes', async () => {
      const result = await crearPropiedadAction(initialState, new FormData())

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.direccion).toBeDefined()
      expect(result.errors.montoInicial).toBeDefined()
      expect(mocks.withTransaction).not.toHaveBeenCalled()
    })
  })
})
