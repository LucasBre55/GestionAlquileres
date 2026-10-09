'use server'

import { z } from 'zod'
import { withTransaction } from '@/db/transaction'
import { crearPropiedad } from '@/lib/crear-propiedad'
import {
  CAMPOS_PROPIEDAD,
  crearPropiedadSchema,
  type PropiedadErrors,
} from '@/lib/propiedad-schema'
import { requireSession } from '@/lib/require-session'

export type PropiedadState =
  | { success: true; id: number }
  | { success: false; errors: PropiedadErrors }

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
