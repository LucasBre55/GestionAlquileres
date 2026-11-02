import { BlobNotFoundError, BlobStoreNotFoundError } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eliminarContratoPDF: vi.fn(),
}))

vi.mock('@/lib/blob', () => ({ eliminarContratoPDF: mocks.eliminarContratoPDF }))

import {
  ajustesAlquiler,
  gastos,
  impuestos,
  pagos,
  propiedades,
  usuarios,
} from '@/db/schema'
import { testDb } from '@/db/test-client'
import { eliminarPropiedad } from '@/lib/eliminar-propiedad'

let propietarioId: number
let otroPropietarioId: number

async function insertarPropiedad(
  overrides: Partial<typeof propiedades.$inferInsert> = {}
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
      contratoPdfUrl: null,
      ...overrides,
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
  mocks.eliminarContratoPDF.mockResolvedValue(undefined)
  const [owner, other] = await testDb
    .insert(usuarios)
    .values([
      { nombre: 'Dueño', email: 'dueno@example.com', passwordHash: 'x' },
      { nombre: 'Otro', email: 'otro@example.com', passwordHash: 'x' },
    ])
    .returning({ id: usuarios.id })
  propietarioId = owner.id
  otroPropietarioId = other.id
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('eliminarPropiedad', () => {
  describe('delete and cascade', () => {
    it('deletes the property and cascades to ajustes, impuestos, gastos and pagos', async () => {
      const id = await insertarPropiedad()
      await testDb.insert(ajustesAlquiler).values({ propiedadId: id, monto: '150000.50', vigenteDesde: '2026-03-01' })
      const [impuesto] = await testDb
        .insert(impuestos)
        .values({ propiedadId: id, tipo: 'ABL', periodicidad: 'mensual' })
        .returning({ id: impuestos.id })
      await testDb.insert(gastos).values({ propiedadId: id, categoria: 'reparacion', monto: '5000.00', fecha: '2026-04-01' })
      // A payment that references a tax: pagos.impuesto_id is ON DELETE RESTRICT, so the
      // cascade has to remove the payment together with (or before) its tax
      await testDb.insert(pagos).values([
        {
          propiedadId: id,
          tipo: 'impuesto',
          impuestoId: impuesto.id,
          periodo: '2026-04-01',
          montoCorrespondiente: '1000.00',
          fechaVencimiento: '2026-04-10',
        },
        {
          propiedadId: id,
          tipo: 'alquiler',
          periodo: '2026-04-01',
          montoCorrespondiente: '170000.00',
          fechaVencimiento: '2026-04-10',
        },
      ])

      const result = await eliminarPropiedad(testDb, propietarioId, id)

      expect(result).toEqual({ status: 'ok' })
      expect(await leer(id)).toBeUndefined()
      expect(await testDb.select().from(ajustesAlquiler)).toHaveLength(0)
      expect(await testDb.select().from(impuestos)).toHaveLength(0)
      expect(await testDb.select().from(gastos)).toHaveLength(0)
      expect(await testDb.select().from(pagos)).toHaveLength(0)
    })

    it('does not touch the other properties of the same owner', async () => {
      const id = await insertarPropiedad()
      const otra = await insertarPropiedad()
      await testDb.insert(gastos).values({ propiedadId: otra, categoria: 'otro', monto: '1.00', fecha: '2026-04-01' })

      await eliminarPropiedad(testDb, propietarioId, id)

      expect(await leer(otra)).toBeDefined()
      expect(await testDb.select().from(gastos)).toHaveLength(1)
    })
  })

  describe('ownership', () => {
    it('returns "no_encontrada", keeps the row and never calls Blob for another owner\'s property', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/ajeno.pdf' })
      const antes = await leer(id)

      const result = await eliminarPropiedad(testDb, otroPropietarioId, id)

      expect(result).toEqual({ status: 'no_encontrada' })
      expect(await leer(id)).toEqual(antes)
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
    })

    it('scopes the DELETE by owner too, even if the SELECT was fooled (defense in depth)', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: null })
      const antes = await leer(id)
      // The SELECT claims the property is visible to the other owner; the DELETE must still refuse
      vi.spyOn(testDb, 'select').mockImplementationOnce((() => ({
        from: () => ({ where: async () => [{ id, contratoPdfUrl: null }] }),
      })) as never)

      const result = await eliminarPropiedad(testDb, otroPropietarioId, id)

      expect(result).toEqual({ status: 'no_encontrada' })
      expect(await leer(id)).toEqual(antes)
    })

    it('returns the exact same result for a property that does not exist, without calling Blob', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/ajeno.pdf' })

      const ajena = await eliminarPropiedad(testDb, otroPropietarioId, id)
      const inexistente = await eliminarPropiedad(testDb, propietarioId, id + 1000)

      expect(inexistente).toEqual(ajena)
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
    })
  })

  describe('contract file (Blob)', () => {
    it('deletes the file with the stored value, as is, and the row still exists at that moment', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/77.pdf' })
      let filaExistiaAlLlamar: boolean | undefined
      mocks.eliminarContratoPDF.mockImplementation(async () => {
        filaExistiaAlLlamar = (await leer(id)) !== undefined
      })

      const result = await eliminarPropiedad(testDb, propietarioId, id)

      expect(result).toEqual({ status: 'ok' })
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledTimes(1)
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledWith('contratos/77.pdf')
      // Blob first, database second: the order is what makes a failure retryable
      expect(filaExistiaAlLlamar).toBe(true)
      expect(await leer(id)).toBeUndefined()
    })

    it('does not call Blob when the property has no contract', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: null })

      const result = await eliminarPropiedad(testDb, propietarioId, id)

      expect(result).toEqual({ status: 'ok' })
      expect(mocks.eliminarContratoPDF).not.toHaveBeenCalled()
      expect(await leer(id)).toBeUndefined()
    })

    it('treats a BlobNotFoundError as success and still deletes the property', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/ya-borrado.pdf' })
      mocks.eliminarContratoPDF.mockRejectedValue(new BlobNotFoundError())

      const result = await eliminarPropiedad(testDb, propietarioId, id)

      expect(result).toEqual({ status: 'ok' })
      expect(await leer(id)).toBeUndefined()
    })

    it('aborts on a BlobStoreNotFoundError (configuration error) and keeps the row', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/1.pdf' })
      const antes = await leer(id)
      const error = new BlobStoreNotFoundError()
      mocks.eliminarContratoPDF.mockRejectedValue(error)

      await expect(eliminarPropiedad(testDb, propietarioId, id)).rejects.toBe(error)

      expect(await leer(id)).toEqual(antes)
    })

    it('aborts on any other error (network, permissions...) and keeps the row', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/1.pdf' })
      const antes = await leer(id)
      const error = new Error('fetch failed')
      mocks.eliminarContratoPDF.mockRejectedValue(error)

      await expect(eliminarPropiedad(testDb, propietarioId, id)).rejects.toBe(error)

      expect(await leer(id)).toEqual(antes)
    })

    it('does not swallow an error just because its message says "not found"', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/1.pdf' })
      const error = new Error('Vercel Blob: The requested blob does not exist')
      mocks.eliminarContratoPDF.mockRejectedValue(error)

      await expect(eliminarPropiedad(testDb, propietarioId, id)).rejects.toBe(error)

      expect(await leer(id)).toBeDefined()
    })
  })

  describe('recovery when the database fails after the file was deleted', () => {
    it('keeps the row on the failure and a retry (file already gone) completes the delete', async () => {
      const id = await insertarPropiedad({ contratoPdfUrl: 'contratos/9.pdf' })
      const antes = await leer(id)
      const falla = new Error('database unavailable')
      const spy = vi.spyOn(testDb, 'delete').mockImplementationOnce(() => {
        throw falla
      })

      // First attempt: the file is deleted, then the database delete throws
      await expect(eliminarPropiedad(testDb, propietarioId, id)).rejects.toBe(falla)
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledTimes(1)
      expect(await leer(id)).toEqual(antes)
      spy.mockRestore()

      // Retry from the UI: the file does not exist anymore, which must not block the delete
      mocks.eliminarContratoPDF.mockRejectedValue(new BlobNotFoundError())
      const result = await eliminarPropiedad(testDb, propietarioId, id)

      expect(result).toEqual({ status: 'ok' })
      expect(mocks.eliminarContratoPDF).toHaveBeenCalledTimes(2)
      expect(mocks.eliminarContratoPDF).toHaveBeenLastCalledWith('contratos/9.pdf')
      expect(await leer(id)).toBeUndefined()
    })
  })
})
