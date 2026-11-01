import { and, eq, sql } from 'drizzle-orm'
import type { DbExecutor } from '@/db/executor'
import { propiedades } from '@/db/schema'
import { MENSAJE_FIN_POSTERIOR_A_INICIO, type EditarPropiedadInput } from '@/lib/propiedad-schema'

export type EditarPropiedadResultado =
  | { status: 'ok' }
  // Mismo resultado si la propiedad no existe o es de otro propietario: no se revela cuál
  | { status: 'no_encontrada' }
  | { status: 'invalida'; errors: { fechaFinContrato: string[] } }

// No abre transacciones: el UPDATE es una única sentencia atómica por sí sola, así que
// sirve igual con el cliente HTTP de Neon que con una transacción.
export async function editarPropiedad(
  executor: DbExecutor,
  propietarioId: number,
  propiedadId: number,
  datos: EditarPropiedadInput
): Promise<EditarPropiedadResultado> {
  const dueno = and(eq(propiedades.id, propiedadId), eq(propiedades.propietarioId, propietarioId))

  const [actual] = await executor
    .select({ fechaInicioContrato: propiedades.fechaInicioContrato })
    .from(propiedades)
    .where(dueno)
  if (!actual) return { status: 'no_encontrada' }

  // Contra la fecha de inicio guardada (el formulario no la envía). Las fechas ISO se
  // comparan como string: pasar por Date correría el día según la zona horaria.
  if (datos.fechaFinContrato <= actual.fechaInicioContrato) {
    return { status: 'invalida', errors: { fechaFinContrato: [MENSAJE_FIN_POSTERIOR_A_INICIO] } }
  }

  const actualizadas = await executor
    .update(propiedades)
    .set({
      inquilinoActual: datos.inquilinoActual,
      contactoInquilino: datos.contactoInquilino,
      direccion: datos.direccion,
      fechaFinContrato: datos.fechaFinContrato,
      frecuenciaAumento: datos.frecuenciaAumento,
      // En el SET de Postgres las referencias a columnas leen la fila vieja: si había un
      // inquilino y cambia (o se vacía), pasa a anterior; si ya estaba vacía o no cambió,
      // se conserva el anterior que hubiera.
      inquilinoAnterior: sql`CASE WHEN ${propiedades.inquilinoActual} IS NOT NULL AND ${propiedades.inquilinoActual} IS DISTINCT FROM ${datos.inquilinoActual} THEN ${propiedades.inquilinoActual} ELSE ${propiedades.inquilinoAnterior} END`,
    })
    .where(dueno)
    .returning({ id: propiedades.id })

  // La propiedad pudo borrarse entre la lectura y el UPDATE
  if (actualizadas.length === 0) return { status: 'no_encontrada' }

  return { status: 'ok' }
}
