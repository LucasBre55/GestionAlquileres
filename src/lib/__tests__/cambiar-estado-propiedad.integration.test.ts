import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { propiedades, usuarios } from '@/db/schema'
import { testDb } from '@/db/test-client'
import { cambiarEstadoPropiedad } from '@/lib/cambiar-estado-propiedad'

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

describe('cambiarEstadoPropiedad', () => {
  it('activa -> inactiva changes only the estado column', async () => {
    const id = await insertarPropiedad({ estado: 'activa' })
    const antes = await leer(id)

    const result = await cambiarEstadoPropiedad(testDb, propietarioId, id, 'inactiva')

    expect(result).toEqual({ status: 'ok' })
    expect(await leer(id)).toEqual({ ...antes, estado: 'inactiva' })
  })

  it('inactiva -> activa changes only the estado column', async () => {
    const id = await insertarPropiedad({ estado: 'inactiva' })
    const antes = await leer(id)

    const result = await cambiarEstadoPropiedad(testDb, propietarioId, id, 'activa')

    expect(result).toEqual({ status: 'ok' })
    expect(await leer(id)).toEqual({ ...antes, estado: 'activa' })
  })

  it.each(['activa', 'inactiva'] as const)(
    'setting the estado it already has (%s) is OK and changes nothing',
    async (estado) => {
      const id = await insertarPropiedad({ estado })
      const antes = await leer(id)

      const result = await cambiarEstadoPropiedad(testDb, propietarioId, id, estado)

      expect(result).toEqual({ status: 'ok' })
      expect(await leer(id)).toEqual(antes)
    }
  )

  it('does not touch the other properties of the same owner', async () => {
    const id = await insertarPropiedad({ estado: 'activa' })
    const otraDelDueno = await insertarPropiedad({ estado: 'activa' })
    const antesOtra = await leer(otraDelDueno)

    await cambiarEstadoPropiedad(testDb, propietarioId, id, 'inactiva')

    expect(await leer(otraDelDueno)).toEqual(antesOtra)
  })

  describe('ownership', () => {
    it('returns "no_encontrada" and modifies nothing for another owner\'s property', async () => {
      const id = await insertarPropiedad({ estado: 'activa' })
      const antes = await leer(id)

      const result = await cambiarEstadoPropiedad(testDb, otroPropietarioId, id, 'inactiva')

      expect(result).toEqual({ status: 'no_encontrada' })
      expect(await leer(id)).toEqual(antes)
    })

    it('returns the exact same result for a property that does not exist', async () => {
      const id = await insertarPropiedad()

      const ajena = await cambiarEstadoPropiedad(testDb, otroPropietarioId, id, 'inactiva')
      const inexistente = await cambiarEstadoPropiedad(testDb, propietarioId, id + 1000, 'inactiva')

      expect(inexistente).toEqual(ajena)
    })
  })
})
