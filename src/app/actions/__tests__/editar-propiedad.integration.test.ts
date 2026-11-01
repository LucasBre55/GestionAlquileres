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

import { editarPropiedadAction } from '@/app/actions/propiedades'
import { propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'

const initialState = { success: false as const, errors: {} }

function buildFormData(propiedadId: number | string, overrides: Record<string, string> = {}) {
  const formData = new FormData()
  const fields: Record<string, string> = {
    propiedadId: String(propiedadId),
    inquilinoActual: 'Ana Gómez',
    contactoInquilino: 'ana@example.com',
    direccion: 'Calle Nueva 99',
    fechaFinContrato: '2029-03-01',
    frecuenciaAumento: '6',
    ...overrides,
  }
  for (const [key, value] of Object.entries(fields)) formData.set(key, value)
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
      inquilinoAnterior: null,
      direccion: 'Av. Colón 1234',
      montoInicial: '150000.50',
      fechaInicioContrato: '2026-03-01',
      fechaFinContrato: '2028-03-01',
      frecuenciaAumento: 4,
      montoActual: '170000.00',
      deudaAcumulada: '12345.67',
      estado: 'inactiva',
      contratoPdfUrl: 'https://blob.example/contrato.pdf',
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

describe('editarPropiedadAction', () => {
  describe('session', () => {
    it('redirects to /api/session/expired when there is no session, touching nothing', async () => {
      mocks.getSession.mockResolvedValue(null)
      const antes = await leer(propiedadId)

      await expect(
        editarPropiedadAction(initialState, buildFormData(propiedadId))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('redirects when the session was revoked or expired', async () => {
      mocks.isSessionActive.mockResolvedValue(false)
      const antes = await leer(propiedadId)

      await expect(
        editarPropiedadAction(initialState, buildFormData(propiedadId))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
      expect(mocks.isSessionActive).toHaveBeenCalledWith('sid')
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('checks the session before validating the input', async () => {
      mocks.getSession.mockResolvedValue(null)

      await expect(
        editarPropiedadAction(initialState, buildFormData(propiedadId, { direccion: '' }))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
    })
  })

  describe('success', () => {
    it('edits the property and returns { success: true } without redirecting', async () => {
      const result = await editarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result).toEqual({ success: true })
      expect(await leer(propiedadId)).toMatchObject({
        inquilinoActual: 'Ana Gómez',
        inquilinoAnterior: 'Juan Pérez',
        contactoInquilino: 'ana@example.com',
        direccion: 'Calle Nueva 99',
        fechaFinContrato: '2029-03-01',
        frecuenciaAumento: 6,
      })
      expect(mocks.redirect).not.toHaveBeenCalled()
    })
  })

  describe('owner', () => {
    it('ignores a propietarioId sent in the FormData and uses the session owner', async () => {
      // Session owner edits their own property while claiming to be somebody else
      const result = await editarPropiedadAction(
        initialState,
        buildFormData(propiedadId, { propietarioId: String(otherUserId) })
      )

      expect(result).toEqual({ success: true })
      expect((await leer(propiedadId)).propietarioId).toBe(ownerId)
    })

    it('cannot edit another owner\'s property by sending their id in the FormData', async () => {
      const antes = await leer(otraPropiedadId)

      const result = await editarPropiedadAction(
        initialState,
        buildFormData(otraPropiedadId, { propietarioId: String(otherUserId) })
      )

      expect(result.success).toBe(false)
      expect(await leer(otraPropiedadId)).toEqual(antes)
    })

    it('answers identically for another owner\'s property and for one that does not exist', async () => {
      const ajena = await editarPropiedadAction(initialState, buildFormData(otraPropiedadId))
      const inexistente = await editarPropiedadAction(initialState, buildFormData(999999))

      expect(ajena.success).toBe(false)
      expect(inexistente).toEqual(ajena)
    })
  })

  describe('field whitelist', () => {
    it('ignores montoInicial, fechaInicioContrato, estado, deudaAcumulada and contratoPdfUrl', async () => {
      const antes = await leer(propiedadId)

      const result = await editarPropiedadAction(
        initialState,
        buildFormData(propiedadId, {
          montoInicial: '1.00',
          fechaInicioContrato: '2000-01-01',
          montoActual: '1.00',
          deudaAcumulada: '0.00',
          estado: 'activa',
          contratoPdfUrl: 'https://evil.example/x.pdf',
        })
      )

      expect(result).toEqual({ success: true })
      const despues = await leer(propiedadId)
      expect(despues).toMatchObject({
        montoInicial: antes.montoInicial,
        fechaInicioContrato: antes.fechaInicioContrato,
        montoActual: antes.montoActual,
        deudaAcumulada: antes.deudaAcumulada,
        estado: antes.estado,
        contratoPdfUrl: antes.contratoPdfUrl,
      })
    })
  })

  describe('validation', () => {
    it('returns errors per field and does not touch the database', async () => {
      const select = vi.spyOn(testDb, 'select')
      const update = vi.spyOn(testDb, 'update')
      const antes = await leer(propiedadId)
      select.mockClear()

      const result = await editarPropiedadAction(
        initialState,
        buildFormData(propiedadId, { direccion: '', fechaFinContrato: '2026-02-30', frecuenciaAumento: '0' })
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(Object.keys(result.errors).sort()).toEqual([
        'direccion',
        'fechaFinContrato',
        'frecuenciaAumento',
      ])
      expect(select).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it.each(['', '0', '-1', '1.5', 'abc', '1e3'])(
      'rejects the invalid propiedadId %j without touching the database',
      async (id) => {
        const select = vi.spyOn(testDb, 'select')
        const update = vi.spyOn(testDb, 'update')

        const result = await editarPropiedadAction(initialState, buildFormData(id))

        expect(result.success).toBe(false)
        if (result.success) return
        expect(result.errors.propiedadId).toBeDefined()
        expect(select).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
      }
    )

    it('rejects a missing propiedadId', async () => {
      const formData = buildFormData(propiedadId)
      formData.delete('propiedadId')

      const result = await editarPropiedadAction(initialState, formData)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.propiedadId).toBeDefined()
    })

    it('reports an end date not after the stored start date on fechaFinContrato', async () => {
      const antes = await leer(propiedadId)

      const result = await editarPropiedadAction(
        initialState,
        buildFormData(propiedadId, { fechaFinContrato: '2026-03-01' })
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.fechaFinContrato).toBeDefined()
      expect(await leer(propiedadId)).toEqual(antes)
    })

    it('treats missing fields as validation errors, not crashes', async () => {
      const formData = new FormData()
      formData.set('propiedadId', String(propiedadId))

      const result = await editarPropiedadAction(initialState, formData)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.direccion).toBeDefined()
      expect(result.errors.fechaFinContrato).toBeDefined()
    })
  })
})
