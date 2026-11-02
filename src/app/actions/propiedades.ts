'use server'

import { z } from 'zod'
import { db } from '@/db'
import { withTransaction } from '@/db/transaction'
import { crearPropiedad } from '@/lib/crear-propiedad'
import { cambiarEstadoPropiedad } from '@/lib/cambiar-estado-propiedad'
import { editarPropiedad } from '@/lib/editar-propiedad'
import { eliminarPropiedad } from '@/lib/eliminar-propiedad'
import {
  cambiarEstadoSchema,
  CAMPOS_CAMBIAR_ESTADO,
  CAMPOS_EDITAR_PROPIEDAD,
  CAMPOS_PROPIEDAD,
  crearPropiedadSchema,
  editarPropiedadSchema,
  propiedadIdSchema,
  type CambiarEstadoErrors,
  type EditarPropiedadErrors,
  type EliminarPropiedadErrors,
  type PropiedadErrors,
} from '@/lib/propiedad-schema'
import { requireSession } from '@/lib/require-session'

// Misma respuesta para una propiedad ajena y para una inexistente: no se revela cuál
const PROPIEDAD_NO_EXISTE = 'La propiedad no existe'
const ERROR_GENERAL_ELIMINAR =
  'No se pudo eliminar la propiedad. Reintentá en unos instantes.'

export type PropiedadState =
  | { success: true; id: number }
  | { success: false; errors: PropiedadErrors }

export type EditarPropiedadState =
  | { success: true }
  | { success: false; errors: EditarPropiedadErrors }

export async function crearPropiedadAction(
  _prevState: PropiedadState,
  formData: FormData
): Promise<PropiedadState> {
  // Primero la sesión: las server actions son endpoints públicos y el layout no las cubre
  const session = await requireSession()

  // Solo se leen los campos del esquema: un propietarioId enviado en el FormData se
  // ignora, el dueño siempre sale de la sesión.
  const raw = Object.fromEntries(
    CAMPOS_PROPIEDAD.map((campo) => [campo, formData.get(campo) ?? undefined])
  )

  // Validar antes de abrir la transacción, para no gastar una conexión a Neon en un
  // input inválido
  const parsed = crearPropiedadSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, errors: z.flattenError(parsed.error).fieldErrors }
  }

  const id = await withTransaction((tx) => crearPropiedad(tx, session.userId, parsed.data))

  // Sin redirect ni revalidatePath: la UI decide qué pasa después
  return { success: true, id }
}

export async function editarPropiedadAction(
  _prevState: EditarPropiedadState,
  formData: FormData
): Promise<EditarPropiedadState> {
  const session = await requireSession()

  // El id de la propiedad es el único dato de identidad que viene del cliente; el
  // dueño sale siempre de la sesión.
  const propiedadId = propiedadIdSchema.safeParse(formData.get('propiedadId'))
  // Whitelist explícita: montoInicial, fechaInicioContrato, estado, deudaAcumulada,
  // contratoPdfUrl y cualquier otro campo del FormData se ignoran.
  const raw = Object.fromEntries(
    CAMPOS_EDITAR_PROPIEDAD.map((campo) => [campo, formData.get(campo) ?? undefined])
  )
  const datos = editarPropiedadSchema.safeParse(raw)

  // Validar todo antes de tocar la base
  if (!propiedadId.success || !datos.success) {
    return {
      success: false,
      errors: {
        ...(datos.success ? {} : z.flattenError(datos.error).fieldErrors),
        ...(propiedadId.success ? {} : { propiedadId: z.flattenError(propiedadId.error).formErrors }),
      },
    }
  }

  const resultado = await editarPropiedad(db, session.userId, propiedadId.data, datos.data)

  switch (resultado.status) {
    case 'ok':
      // Sin redirect ni revalidatePath: la UI decide qué pasa después
      return { success: true }
    case 'invalida':
      return { success: false, errors: resultado.errors }
    case 'no_encontrada':
      // Misma respuesta si no existe o es de otro propietario
      return { success: false, errors: { propiedadId: [PROPIEDAD_NO_EXISTE] } }
  }
}

export type CambiarEstadoState =
  | { success: true }
  | { success: false; errors: CambiarEstadoErrors }

export async function cambiarEstadoPropiedadAction(
  _prevState: CambiarEstadoState,
  formData: FormData
): Promise<CambiarEstadoState> {
  const session = await requireSession()

  // Whitelist explícita: solo propiedadId y estado; el dueño sale de la sesión
  const raw = Object.fromEntries(
    CAMPOS_CAMBIAR_ESTADO.map((campo) => [campo, formData.get(campo) ?? undefined])
  )
  const parsed = cambiarEstadoSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, errors: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await cambiarEstadoPropiedad(
    db,
    session.userId,
    parsed.data.propiedadId,
    parsed.data.estado
  )

  if (resultado.status === 'no_encontrada') {
    return { success: false, errors: { propiedadId: [PROPIEDAD_NO_EXISTE] } }
  }

  // Sin redirect ni revalidatePath: la UI decide qué pasa después
  return { success: true }
}

export type EliminarPropiedadState =
  | { success: true }
  | { success: false; errors: EliminarPropiedadErrors }

// Sin confirmación acá: pedirla antes de invocar esta acción es responsabilidad de la UI.
export async function eliminarPropiedadAction(
  _prevState: EliminarPropiedadState,
  formData: FormData
): Promise<EliminarPropiedadState> {
  const session = await requireSession()

  const propiedadId = propiedadIdSchema.safeParse(formData.get('propiedadId'))
  if (!propiedadId.success) {
    return { success: false, errors: { propiedadId: z.flattenError(propiedadId.error).formErrors } }
  }

  try {
    const resultado = await eliminarPropiedad(db, session.userId, propiedadId.data)
    if (resultado.status === 'no_encontrada') {
      return { success: false, errors: { propiedadId: [PROPIEDAD_NO_EXISTE] } }
    }
  } catch (error) {
    // Solo la clase y el mensaje: nunca el token de Blob ni nada de process.env. El nombre
    // sale del constructor porque los errores de @vercel/blob dejan `name` en "Error".
    console.error(
      'eliminarPropiedadAction falló:',
      error instanceof Error ? error.constructor.name : typeof error,
      error instanceof Error ? error.message : ''
    )
    return { success: false, errors: { general: [ERROR_GENERAL_ELIMINAR] } }
  }

  // Sin redirect ni revalidatePath: la UI decide qué pasa después
  return { success: true }
}
