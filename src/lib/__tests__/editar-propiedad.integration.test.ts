import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'
import { editarPropiedad } from '@/lib/editar-propiedad'

const datos = {
  inquilinoActual: 'Ana Gómez',
  contactoInquilino: 'ana@example.com',
  direccion: 'Calle Nueva 99',
  fechaFinContrato: '2029-03-01',
  frecuenciaAumento: 6,
}

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

describe('editarPropiedad', () => {
  describe('editable columns', () => {
    it('updates the editable columns and reports success', async () => {
      const id = await insertarPropiedad()

      const result = await editarPropiedad(testDb, propietarioId, id, datos)

      expect(result).toEqual({ status: 'ok' })
      expect(await leer(id)).toMatchObject({
        inquilinoActual: 'Ana Gómez',
        contactoInquilino: 'ana@example.com',
        direccion: 'Calle Nueva 99',
        fechaFinContrato: '2029-03-01',
        frecuenciaAumento: 6,
      })
    })

    it('stores null when the optional tenant fields are cleared', async () => {
      const id = await insertarPropiedad()

      await editarPropiedad(testDb, propietarioId, id, {
        ...datos,
        inquilinoActual: null,
        contactoInquilino: null,
      })

      const row = await leer(id)
      expect(row.inquilinoActual).toBeNull()
      expect(row.contactoInquilino).toBeNull()
    })

    it('leaves every other column untouched', async () => {
      const id = await insertarPropiedad()
      const antes = await leer(id)

      await editarPropiedad(testDb, propietarioId, id, datos)

      const despues = await leer(id)
      expect(despues).toMatchObject({
        id: antes.id,
        propietarioId: antes.propietarioId,
        montoInicial: '150000.50',
        fechaInicioContrato: '2026-03-01',
        montoActual: '170000.00',
        deudaAcumulada: '12345.67',
        estado: 'inactiva',
        contratoPdfUrl: 'https://blob.example/contrato.pdf',
      })
    })
  })

  describe('tenant handover (inquilino_anterior)', () => {
    it('A -> B moves A to inquilino_anterior', async () => {
      const id = await insertarPropiedad({ inquilinoActual: 'A', inquilinoAnterior: null })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: 'B' })

      expect(await leer(id)).toMatchObject({ inquilinoActual: 'B', inquilinoAnterior: 'A' })
    })

    it('A -> A leaves inquilino_anterior unchanged', async () => {
      const id = await insertarPropiedad({ inquilinoActual: 'A', inquilinoAnterior: 'Previo' })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: 'A' })

      expect(await leer(id)).toMatchObject({ inquilinoActual: 'A', inquilinoAnterior: 'Previo' })
    })

    it('A -> A with no previous tenant keeps inquilino_anterior null', async () => {
      const id = await insertarPropiedad({ inquilinoActual: 'A', inquilinoAnterior: null })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: 'A' })

      expect(await leer(id)).toMatchObject({ inquilinoActual: 'A', inquilinoAnterior: null })
    })

    it('A -> null clears inquilino_actual and keeps A as inquilino_anterior', async () => {
      const id = await insertarPropiedad({ inquilinoActual: 'A', inquilinoAnterior: null })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: null })

      expect(await leer(id)).toMatchObject({ inquilinoActual: null, inquilinoAnterior: 'A' })
    })

    it('null -> B keeps the existing inquilino_anterior (the vacancy edge case)', async () => {
      const id = await insertarPropiedad({ inquilinoActual: null, inquilinoAnterior: 'Juan' })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: 'B' })

      expect(await leer(id)).toMatchObject({ inquilinoActual: 'B', inquilinoAnterior: 'Juan' })
    })

    it('null -> B with no previous tenant leaves inquilino_anterior null', async () => {
      const id = await insertarPropiedad({ inquilinoActual: null, inquilinoAnterior: null })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: 'B' })

      expect(await leer(id)).toMatchObject({ inquilinoActual: 'B', inquilinoAnterior: null })
    })

    it('null -> null keeps inquilino_anterior', async () => {
      const id = await insertarPropiedad({ inquilinoActual: null, inquilinoAnterior: 'Juan' })

      await editarPropiedad(testDb, propietarioId, id, { ...datos, inquilinoActual: null })

      expect(await leer(id)).toMatchObject({ inquilinoActual: null, inquilinoAnterior: 'Juan' })
    })
  })

  describe('ownership', () => {
    it('returns "no_encontrada" and modifies nothing for another owner\'s property', async () => {
      const id = await insertarPropiedad()
      const antes = await leer(id)

      const result = await editarPropiedad(testDb, otroPropietarioId, id, datos)

      expect(result).toEqual({ status: 'no_encontrada' })
      expect(await leer(id)).toEqual(antes)
    })

    it('returns the exact same result for a property that does not exist', async () => {
      const id = await insertarPropiedad()

      const ajena = await editarPropiedad(testDb, otroPropietarioId, id, datos)
      const inexistente = await editarPropiedad(testDb, propietarioId, id + 1000, datos)

      expect(inexistente).toEqual(ajena)
    })
  })

  describe('contract end date', () => {
    it.each([
      ['equal to', '2026-03-01'],
      ['before', '2026-02-28'],
    ])('rejects an end date %s the stored start date, reported on fechaFinContrato', async (_l, fin) => {
      const id = await insertarPropiedad({ fechaInicioContrato: '2026-03-01' })
      const antes = await leer(id)

      const result = await editarPropiedad(testDb, propietarioId, id, {
        ...datos,
        fechaFinContrato: fin,
      })

      expect(result.status).toBe('invalida')
      if (result.status !== 'invalida') return
      expect(Object.keys(result.errors)).toEqual(['fechaFinContrato'])
      expect(result.errors.fechaFinContrato?.[0]).toEqual(expect.any(String))
      expect(await leer(id)).toEqual(antes)
    })

    it('accepts an end date one day after the stored start date', async () => {
      const id = await insertarPropiedad({ fechaInicioContrato: '2026-03-01' })

      const result = await editarPropiedad(testDb, propietarioId, id, {
        ...datos,
        fechaFinContrato: '2026-03-02',
      })

      expect(result).toEqual({ status: 'ok' })
      expect((await leer(id)).fechaFinContrato).toBe('2026-03-02')
    })
  })
})
