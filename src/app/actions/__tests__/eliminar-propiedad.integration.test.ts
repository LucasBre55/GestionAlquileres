import { BlobNotFoundError, BlobStoreNotFoundError } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSessionActive: vi.fn(),
  eliminarContratoPDF: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/session-store', () => ({ isSessionActive: mocks.isSessionActive }))
vi.mock('@/lib/blob', () => ({ eliminarContratoPDF: mocks.eliminarContratoPDF }))
// Production uses the Neon HTTP client; tests run the same action against the test database
vi.mock('@/db', async () => ({ db: (await import('@/db/test-client')).testDb }))

import { eliminarPropiedadAction } from '@/app/actions/propiedades'
import { propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'

const initialState = { success: false as const, errors: {} }
const TOKEN_FALSO = 'vercel_blob_rw_SECRETO_que_no_debe_loguearse'

function buildFormData(propiedadId: number | string, extra: Record<string, string> = {}) {
  const formData = new FormData()
  formData.set('propiedadId', String(propiedadId))
  for (const [key, value] of Object.entries(extra)) formData.set(key, value)
  return formData
}

let ownerId: number
let otherUserId: number
let propiedadId: number
let otraPropiedadId: number
let consoleError: MockInstance<typeof console.error>

async function insertarPropiedad(
  propietarioId: number,
  contratoPdfUrl: string | null
): Promise<number> {
  const [row] = await testDb
    .insert(propiedades)
    .values({
      propietarioId,
      inquilinoActual: 'Juan Pérez',
      direccion: 'Av. Colón 1234',
      montoInicial: '150000.50',
      fechaInicioContrato: '2026-03-01',
      fechaFinContrato: '2028-03-01',
      frecuenciaAumento: 4,
      montoActual: '170000.00',
      contratoPdfUrl,
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
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN_FALSO)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const [owner, other] = await testDb
    .insert(usuarios)
    .values([
      { nombre: 'Dueño', email: 'dueno@example.com', passwordHash: 'x' },
      { nombre: 'Otro', email: 'otro@example.com', passwordHash: 'x' },
    ])
    .returning({ id: usuarios.id })
  ownerId = owner.id
  otherUserId = other.id
  propiedadId = await insertarPropiedad(ownerId, 'contratos/1.pdf')
  otraPropiedadId = await insertarPropiedad(otherUserId, 'contratos/ajeno.pdf')

  mocks.getSession.mockResolvedValue({ userId: ownerId, email: 'dueno@example.com', sessionId: 'sid' })
  mocks.isSessionActive.mockResolvedValue(true)
  mocks.eliminarContratoPDF.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('eliminarPropiedadAction', () => {
  describe('session', () => {
    it('redirects to /api/session/expired without touching the database or Blob when there is no session', async () => {
      mocks.getSession.mockResolvedValue(null)
      const select = vi.spyOn(testDb, 'select')
      const del = vi.spyOn(testDb, 'delete')

      await expect(
        eliminarPropiedadAction(initialState, buildFormData(propiedadId))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')

      expect(select).not.toHaveBeenCalled()
      expect(del).not.toHaveBeenCalled()
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      expect(await leer(propiedadId)).toBeDefined()
    })

    it('redirects without touching the database or Blob when the session was revoked or expired', async () => {
      mocks.isSessionActive.mockResolvedValue(false)
      const select = vi.spyOn(testDb, 'select')
      const del = vi.spyOn(testDb, 'delete')

      await expect(
        eliminarPropiedadAction(initialState, buildFormData(propiedadId))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')

      expect(mocks.isSessionActive).toHaveBeenCalledWith('sid')
      expect(select).not.toHaveBeenCalled()
      expect(del).not.toHaveBeenCalled()
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      expect(await leer(propiedadId)).toBeDefined()
    })

    it('checks the session before validating the input', async () => {
      mocks.getSession.mockResolvedValue(null)

      await expect(
        eliminarPropiedadAction(initialState, buildFormData('abc'))
      ).rejects.toThrow('NEXT_REDIRECT:/api/session/expired')
    })
  })

  describe('success', () => {
    it('deletes the file and the property, returns { success: true } and does not redirect', async () => {
      const result = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result).toEqual({ success: true })
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledWith('contratos/1.pdf')
      expect(await leer(propiedadId)).toBeUndefined()
      expect(mocks.redirect).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('deletes a property without contract and does not call Blob', async () => {
      const sinContrato = await insertarPropiedad(ownerId, null)

      const result = await eliminarPropiedadAction(initialState, buildFormData(sinContrato))

      expect(result).toEqual({ success: true })
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      expect(await leer(sinContrato)).toBeUndefined()
    })

    it('deletes the property even if the file was already gone (BlobNotFoundError)', async () => {
      mocks.eliminarContratoPDF.mockRejectedValue(new BlobNotFoundError())

      const result = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result).toEqual({ success: true })
      expect(await leer(propiedadId)).toBeUndefined()
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe('owner', () => {
    it('ignores a propietarioId sent in the FormData and cannot delete another owner\'s property', async () => {
      const antes = await leer(otraPropiedadId)

      const result = await eliminarPropiedadAction(
        initialState,
        buildFormData(otraPropiedadId, { propietarioId: String(otherUserId) })
      )

      expect(result.success).toBe(false)
      expect(await leer(otraPropiedadId)).toEqual(antes)
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
    })

    it('answers identically (errors.propiedadId) for another owner\'s property and for one that does not exist', async () => {
      const ajena = await eliminarPropiedadAction(initialState, buildFormData(otraPropiedadId))
      const inexistente = await eliminarPropiedadAction(initialState, buildFormData(999999))

      expect(ajena.success).toBe(false)
      if (ajena.success) return
      expect(ajena.errors.propiedadId).toBeDefined()
      expect(ajena.errors.general).toBeUndefined()
      expect(inexistente).toEqual(ajena)
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it.each(['', '0', '-1', '1.5', 'abc', '1e3'])(
      'rejects the invalid propiedadId %j without touching the database or Blob',
      async (id) => {
        const select = vi.spyOn(testDb, 'select')
        const del = vi.spyOn(testDb, 'delete')

        const result = await eliminarPropiedadAction(initialState, buildFormData(id))

        expect(result.success).toBe(false)
        if (result.success) return
        expect(result.errors.propiedadId).toBeDefined()
        expect(select).not.toHaveBeenCalled()
        expect(del).not.toHaveBeenCalled()
        expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      }
    )

    it('treats a missing propiedadId as a validation error, not a crash', async () => {
      const result = await eliminarPropiedadAction(initialState, new FormData())

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.propiedadId).toBeDefined()
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
    })
  })

  describe('failures', () => {
    it('returns errors.general, keeps the row and logs the class name and message on a BlobStoreNotFoundError', async () => {
      mocks.eliminarContratoPDF.mockRejectedValue(new BlobStoreNotFoundError())
      const antes = await leer(propiedadId)

      const result = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.general).toEqual([expect.stringMatching(/reintent/i)])
      expect(await leer(propiedadId)).toEqual(antes)
      expect(consoleError).toHaveBeenCalledTimes(1)
      const logueado = consoleError.mock.calls[0].map(String).join(' ')
      expect(logueado).toContain('BlobStoreNotFoundError')
      expect(logueado).toContain('This store does not exist')
    })

    it('returns errors.general and keeps the row on a generic error', async () => {
      mocks.eliminarContratoPDF.mockRejectedValue(new Error('fetch failed'))
      const antes = await leer(propiedadId)

      const result = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.general).toEqual([expect.stringMatching(/reintent/i)])
      expect(await leer(propiedadId)).toEqual(antes)
      const logueado = consoleError.mock.calls[0].map(String).join(' ')
      expect(logueado).toContain('Error')
      expect(logueado).toContain('fetch failed')
    })

    it('returns errors.general and logs the error when the database fails after the file was deleted', async () => {
      const antes = await leer(propiedadId)
      vi.spyOn(testDb, 'delete').mockImplementationOnce(() => {
        throw new TypeError('database unavailable')
      })

      const result = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errors.general).toEqual([expect.stringMatching(/reintent/i)])
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledTimes(1)
      expect(await leer(propiedadId)).toEqual(antes)
      const logueado = consoleError.mock.calls[0].map(String).join(' ')
      expect(logueado).toContain('TypeError')
      expect(logueado).toContain('database unavailable')
    })

    it('recovers on retry: the file is already gone and the second attempt deletes the property', async () => {
      vi.spyOn(testDb, 'delete').mockImplementationOnce(() => {
        throw new Error('database unavailable')
      })
      const primero = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))
      expect(primero.success).toBe(false)

      mocks.eliminarContratoPDF.mockRejectedValue(new BlobNotFoundError())
      const segundo = await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      expect(segundo).toEqual({ success: true })
      expect(await leer(propiedadId)).toBeUndefined()
    })

    it('never logs the Blob token nor anything from process.env', async () => {
      mocks.eliminarContratoPDF.mockRejectedValue(new Error(`boom`))

      await eliminarPropiedadAction(initialState, buildFormData(propiedadId))

      const todo = JSON.stringify(consoleError.mock.calls.map((llamada) => llamada.map(String)))
      expect(todo).not.toContain(TOKEN_FALSO)
      expect(todo).not.toContain('BLOB_READ_WRITE_TOKEN')
    })
  })
})
