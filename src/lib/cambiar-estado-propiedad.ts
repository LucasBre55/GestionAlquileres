import { and, eq } from 'drizzle-orm'
import type { DbExecutor } from '@/db/executor'
import { propiedades } from '@/db/schema'
import type { EstadoPropiedad } from '@/lib/propiedad-schema'

export type CambiarEstadoResultado =
  | { status: 'ok' }
  // Mismo resultado si la propiedad no existe o es de otro propietario: no se revela cuál
  | { status: 'no_encontrada' }

// Un único UPDATE que toca solo `estado`. Cambiar al estado que ya tiene no es un error:
// la sentencia igual devuelve la fila.
export async function cambiarEstadoPropiedad(
  executor: DbExecutor,
  propietarioId: number,
  propiedadId: number,
  estado: EstadoPropiedad
): Promise<CambiarEstadoResultado> {
  const actualizadas = await executor
    .update(propiedades)
    .set({ estado })
    .where(and(eq(propiedades.id, propiedadId), eq(propiedades.propietarioId, propietarioId)))
    .returning({ id: propiedades.id })

  if (actualizadas.length === 0) return { status: 'no_encontrada' }

  return { status: 'ok' }
}
