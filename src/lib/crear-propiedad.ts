import type { DbExecutor } from '@/db/executor'
import { ajustesAlquiler, propiedades } from '@/db/schema'
import type { PropiedadInput } from '@/lib/propiedad-schema'

// No abre transacciones: recibe el ejecutor ya abierto, así los dos inserts son
// atómicos solo si el llamador los corre dentro de una transacción.
export async function crearPropiedad(
  tx: DbExecutor,
  propietarioId: number,
  datos: PropiedadInput
): Promise<number> {
  const [propiedad] = await tx
    .insert(propiedades)
    .values({
      propietarioId,
      inquilinoActual: datos.inquilinoActual,
      contactoInquilino: datos.contactoInquilino,
      inquilinoAnterior: null,
      direccion: datos.direccion,
      montoInicial: datos.montoInicial,
      fechaInicioContrato: datos.fechaInicioContrato,
      fechaFinContrato: datos.fechaFinContrato,
      frecuenciaAumento: datos.frecuenciaAumento,
      montoActual: datos.montoInicial,
      deudaAcumulada: '0',
      estado: 'activa',
      // El contrato se sube después, desde el detalle de la propiedad
      contratoPdfUrl: null,
    })
    .returning({ id: propiedades.id })

  // Primer registro del historial de montos: lo que rige desde el inicio del contrato
  await tx.insert(ajustesAlquiler).values({
    propiedadId: propiedad.id,
    monto: datos.montoInicial,
    vigenteDesde: datos.fechaInicioContrato,
  })

  return propiedad.id
}
