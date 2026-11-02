import { BlobNotFoundError } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import type { DbExecutor } from '@/db/executor'
import { propiedades } from '@/db/schema'
import { eliminarContratoPDF } from '@/lib/blob'

export type EliminarPropiedadResultado =
  | { status: 'ok' }
  // Mismo resultado si la propiedad no existe o es de otro propietario: no se revela cuál
  | { status: 'no_encontrada' }

// Hard delete. La cascada (ajustes_alquiler, impuestos, gastos, pagos) la define el
// schema. Los fallos de Blob y de la base se propagan: los atrapa la action.
//
// Orden Blob -> base, a propósito. Postgres y Blob son dos sistemas y no hay transacción
// entre ellos, así que se elige qué falla "mejor":
// - Si Blob falla, se aborta antes de tocar la base: la propiedad queda intacta y se
//   reintenta desde la UI. No queda nada huérfano.
// - Si la base falla DESPUÉS de borrar el archivo, la propiedad queda con un
//   contrato_pdf_url que apunta a un archivo inexistente. Es visible y se arregla
//   reintentando (el borrado trata "archivo no encontrado" como éxito). La UI de #52 tiene
//   que tolerar ese link roto.
// - El orden inverso (base primero) dejaría, en el peor caso, un archivo huérfano en Blob:
//   invisible desde la UI, sin nadie que lo referencie, y se paga para siempre.
export async function eliminarPropiedad(
  executor: DbExecutor,
  propietarioId: number,
  propiedadId: number
): Promise<EliminarPropiedadResultado> {
  const dueno = and(eq(propiedades.id, propiedadId), eq(propiedades.propietarioId, propietarioId))

  const [propiedad] = await executor
    .select({ id: propiedades.id, contratoPdfUrl: propiedades.contratoPdfUrl })
    .from(propiedades)
    .where(dueno)
  // Propiedad ajena o inexistente: se termina acá, sin tocar Blob
  if (!propiedad) return { status: 'no_encontrada' }

  if (propiedad.contratoPdfUrl !== null) {
    try {
      // El valor de la columna tal cual: es el pathname que guardó subirContratoPDF
      await eliminarContratoPDF(propiedad.contratoPdfUrl)
    } catch (error) {
      // Solo "el archivo no existe" cuenta como éxito (idempotencia). Se compara por clase,
      // nunca por el texto del mensaje: BlobStoreNotFoundError ("This store does not
      // exist") es un error de configuración y tiene que abortar.
      if (!(error instanceof BlobNotFoundError)) throw error
    }
  }

  const eliminadas = await executor.delete(propiedades).where(dueno).returning({ id: propiedades.id })

  // La propiedad pudo borrarse entre la lectura y el DELETE
  if (eliminadas.length === 0) return { status: 'no_encontrada' }

  return { status: 'ok' }
}
