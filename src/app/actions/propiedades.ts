'use server'

import { z } from 'zod'
import { db } from '@/db'
import { withTransaction } from '@/db/transaction'
import { crearPropiedad } from '@/lib/crear-propiedad'
import { editarPropiedad } from '@/lib/editar-propiedad'
import {
  CAMPOS_EDITAR_PROPIEDAD,
  CAMPOS_PROPIEDAD,
  crearPropiedadSchema,
  editarPropiedadSchema,
  propiedadIdSchema,
  type EditarPropiedadErrors,
  type PropiedadErrors,
} from '@/lib/propiedad-schema'
import { requireSession } from '@/lib/require-session'

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
      return { success: false, errors: { propiedadId: ['La propiedad no existe'] } }
  }
}
