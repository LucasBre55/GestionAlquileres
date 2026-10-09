import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ajustesAlquiler, propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'
import { crearPropiedad } from '@/lib/crear-propiedad'

const datos = {
  inquilinoActual: 'Juan Pérez',
  contactoInquilino: 'juan@example.com',
  direccion: 'Av. Colón 1234, Córdoba',
  montoInicial: '150000.50',
  fechaInicioContrato: '2026-03-01',
  fechaFinContrato: '2028-03-01',
  frecuenciaAumento: 4,
}

let propietarioId: number

beforeEach(async () => {
  const [user] = await testDb
    .insert(usuarios)
    .values({ nombre: 'Dueño', email: 'dueno@example.com', passwordHash: 'x' })
    .returning({ id: usuarios.id })
  propietarioId = user.id
})

describe('crearPropiedad', () => {
  it('inserts the property with the derived initial values and returns its id', async () => {
    const id = await testDb.transaction((tx) => crearPropiedad(tx, propietarioId, datos))

    const [row] = await testDb.select().from(propiedades).where(eq(propiedades.id, id))
    expect(row).toMatchObject({
      propietarioId,
      inquilinoActual: 'Juan Pérez',
      contactoInquilino: 'juan@example.com',
      inquilinoAnterior: null,
      direccion: 'Av. Colón 1234, Córdoba',
      montoInicial: '150000.50',
      montoActual: '150000.50',
      deudaAcumulada: '0.00',
      estado: 'activa',
      contratoPdfUrl: null,
      fechaInicioContrato: '2026-03-01',
      fechaFinContrato: '2028-03-01',
      frecuenciaAumento: 4,
    })
  })

  it('inserts the initial rent adjustment effective from the contract start date', async () => {
    const id = await testDb.transaction((tx) => crearPropiedad(tx, propietarioId, datos))

    const ajustes = await testDb
      .select()
      .from(ajustesAlquiler)
      .where(eq(ajustesAlquiler.propiedadId, id))
    expect(ajustes).toHaveLength(1)
    expect(ajustes[0]).toMatchObject({
      propiedadId: id,
      monto: '150000.50',
      vigenteDesde: '2026-03-01',
    })
  })

  it('stores null for the optional tenant fields', async () => {
    const id = await testDb.transaction((tx) =>
      crearPropiedad(tx, propietarioId, {
        ...datos,
        inquilinoActual: null,
        contactoInquilino: null,
      })
    )

    const [row] = await testDb.select().from(propiedades).where(eq(propiedades.id, id))
    expect(row.inquilinoActual).toBeNull()
    expect(row.contactoInquilino).toBeNull()
  })

  describe('atomicity', () => {
    it('control: without an injected failure both rows are persisted', async () => {
      await testDb.transaction((tx) => crearPropiedad(tx, propietarioId, datos))

      expect(await testDb.select().from(propiedades)).toHaveLength(1)
      expect(await testDb.select().from(ajustesAlquiler)).toHaveLength(1)
    })

    it('leaves no property behind when the second insert (ajustes_alquiler) fails', async () => {
      const failure = new Error('injected failure on ajustes_alquiler')

      await expect(
        testDb.transaction(async (tx) => {
          const insert = tx.insert.bind(tx)
          vi.spyOn(tx, 'insert').mockImplementation((table) => {
            if (table === ajustesAlquiler) throw failure
            return insert(table)
          })
          return crearPropiedad(tx, propietarioId, datos)
        })
      ).rejects.toBe(failure)

      // Queried through testDb, outside the rolled back transaction
      expect(await testDb.select().from(propiedades)).toHaveLength(0)
      expect(await testDb.select().from(ajustesAlquiler)).toHaveLength(0)
    })
  })
})
