import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// Production uses the Neon HTTP client; tests run the same action against the test database
vi.mock('@/db', async () => ({ db: (await import('@/db/test-client')).testDb }))

import { cambiarEstadoPropiedadAction } from '@/app/actions/propiedades'
import { propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'

const initialState = { success: false as const, errors: {} }

function buildFormData(propiedadId: number | string, estado: string, extra: Record<string, string> = {}) {
  const formData = new FormData()
  formData.set('propiedadId', String(propiedadId))
  formData.set('estado', estado)
  for (const [key, value] of Object.entries(extra)) formData.set(key, value)
  return formData
}

let ownerId: number
let otherUserId: number
let propiedadId: number
let otraPropiedadId: number

async function insertarPropiedad(propietarioId: number): Promise<number> {
  const [row] = await testDb
    .insert(propiedades)
    .values({
      propietarioId,
      inquilinoActual: 'Juan Pérez',
      contactoInquilino: 'juan@example.com',
      inquilinoAnterior: 'Previo',
      direccion: 'Av. Colón 1234',
      montoInicial: '150000.50',
      fechaInicioContrato: '2026-03-01',
      fechaFinContrato: '2028-03-01',
      frecuenciaAumento: 4,
      montoActual: '170000.00',
      deudaAcumulada: '12345.67',
      estado: 'activa',
      contratoPdfUrl: 'contratos/1.pdf',
    })
    .returning({ id: propiedades.id })
  return row.id
}

async function leer(id: number) {
  const [row] = await testDb.select().from(propiedades).where(eq(propiedades.id, id))
  return row
}

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
  propiedadId = await insertarPropiedad(ownerId)
  otraPropiedadId = await insertarPropiedad(otherUserId)

  mocks.getSession.mockResolvedValue({ userId: ownerId, email: 'dueno@example.com', sessionId: 'sid' })
  mocks.isSessionActive.mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cambiarEstadoPropiedadAction', () => {
  describe('session', () => {
    it('redirects to /api/session/expired when there is no session, touching nothing', async () => {
      mocks.getSession.mockResolvedValue(null)
      const antes = await leer(propiedadId)

      await expect(
        cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'inactiva'))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('redirects when the session was revoked or expired', async () => {
      mocks.isSessionActive.mockResolvedValue(false)
      const antes = await leer(propiedadId)

      await expect(
        cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'inactiva'))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
      expect(mocks.isSessionActive).toHaveBeenCalledWith('sid')
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('checks the session before validating the input', async () => {
      mocks.getSession.mockResolvedValue(null)

      await expect(
        cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'borrada'))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
    })
  })

  describe('success', () => {
    it('changes only the estado and returns { success: true } without redirecting', async () => {
      const antes = await leer(propiedadId)

      const result = await cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'inactiva'))

      expect(result).toEqual({ success: true })
      expect(await leer(propiedadId)).toEqual({ ...antes, estado: 'inactiva' })
      expect(mocks.redirect).not.toHaveBeenCalled()
    })

    it('is OK when the property already has that estado', async () => {
      const antes = await leer(propiedadId)

      const result = await cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'activa'))

      expect(result).toEqual({ success: true })
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('goes back from inactiva to activa', async () => {
      await cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'inactiva'))
      const result = await cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, 'activa'))

      expect(result).toEqual({ success: true })
      expect((await leer(propiedadId)).estado).toBe('activa')
    })
  })

  describe('owner', () => {
    it('ignores a propietarioId sent in the FormData and uses the session owner', async () => {
      const result = await cambiarEstadoPropiedadAction(
        initialState,
        buildFormData(propiedadId, 'inactiva', { propietarioId: String(otherUserId) })
      )

      expect(result).toEqual({ success: true })
      expect((await leer(propiedadId)).propietarioId).toBe(ownerId)
    })

    it('cannot change another owner\'s property by sending their id in the FormData', async () => {
      const antes = await leer(otraPropiedadId)

      const result = await cambiarEstadoPropiedadAction(
        initialState,
        buildFormData(otraPropiedadId, 'inactiva', { propietarioId: String(otherUserId) })
      )

      expect(result.success).toBe(false)
      expect(await leer(otraPropiedadId)).toEqual(antes)
    })

    it('answers identically for another owner\'s property and for one that does not exist', async () => {
      const ajena = await cambiarEstadoPropiedadAction(initialState, buildFormData(otraPropiedadId, 'inactiva'))
      const inexistente = await cambiarEstadoPropiedadAction(initialState, buildFormData(999999, 'inactiva'))

      expect(ajena.success).toBe(false)
      if (ajena.success) return
      expect(ajena.errors.propiedadId).toBeDefined()
      expect(inexistente).toEqual(ajena)
    })
  })

  describe('field whitelist', () => {
    it('ignores every field other than propiedadId and estado', async () => {
      const antes = await leer(propiedadId)

      const result = await cambiarEstadoPropiedadAction(
        initialState,
        buildFormData(propiedadId, 'inactiva', {
          direccion: 'Hackeada 1',
          inquilinoActual: 'Intruso',
          montoInicial: '1.00',
          montoActual: '1.00',
          deudaAcumulada: '0.00',
          fechaFinContrato: '2099-01-01',
          contratoPdfUrl: 'https://evil.example/x.pdf',
        })
      )

      expect(result).toEqual({ success: true })
      expect(await leer(propiedadId)).toEqual({ ...antes, estado: 'inactiva' })
    })
  })

  describe('validation', () => {
    it.each(['', 'borrada', 'ACTIVA', 'true'])(
      'rejects the invalid estado %j on estado without touching the database',
      async (estado) => {
        const select = vi.spyOn(testDb, 'select')
        const update = vi.spyOn(testDb, 'update')
        const antes = await leer(propiedadId)
        select.mockClear()

        const result = await cambiarEstadoPropiedadAction(initialState, buildFormData(propiedadId, estado))

        expect(result.success).toBe(false)
        if (result.success) return
        expect(result.errors.estado).toBeDefined()
        expect(select).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        expect(await leer(propiedadId)).toEqual(antes)
      }
    )

    it.each(['', '0', '-1', '1.5', 'abc', '1e3'])(
      'rejects the invalid propiedadId %j without touching the database',
      async (id) => {
        const select = vi.spyOn(testDb, 'select')
        const update = vi.spyOn(testDb, 'update')

        const result = await cambiarEstadoPropiedadAction(initialState, buildFormData(id, 'inactiva'))

        expect(result.success).toBe(false)
        if (result.success) return
        expect(result.errors.propiedadId).toBeDefined()
        expect(select).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
      }
    )

    it('treats missing fields as validation errors, not crashes', async () => {
      const result = await cambiarEstadoPropiedadAction(initialState, new FormData())

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.propiedadId).toBeDefined()
      expect(result.errors.estado).toBeDefined()
    })
  })
})
