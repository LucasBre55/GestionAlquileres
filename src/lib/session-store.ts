import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { sesiones } from '@/db/schema'
import { getSessionExpiresAt, hashSessionId } from '@/lib/session-id'

/**
 * Persistencia de sesiones. El JWT sigue siendo la credencial, pero la fila en
 * `sesiones` es la fuente de verdad adicional que permite invalidarla antes de
 * que expire. Solo se guarda el hash del identificador, nunca el identificador.
 *
 * Mejora futura: no hay limpieza automática de filas expiradas o revocadas, la
 * tabla crece indefinidamente. Con un solo propietario el volumen es
 * insignificante (igual criterio que `intentos_login`).
 */

export async function createSessionRecord({
  usuarioId,
  sessionId,
  now,
}: {
  usuarioId: number
  sessionId: string
  now: Date
}): Promise<void> {
  await db.insert(sesiones).values({
    usuarioId,
    tokenHash: hashSessionId(sessionId),
    createdAt: now,
    expiresAt: getSessionExpiresAt(now),
    revokedAt: null,
  })
}

/** true si existe la sesión, no está revocada y no expiró. */
export async function isSessionActive(
  sessionId: string | undefined,
  now: Date = new Date()
): Promise<boolean> {
  // Los JWT emitidos antes de esta tabla no traen sessionId: no son válidos
  if (!sessionId) return false

  const [row] = await db
    .select({ id: sesiones.id })
    .from(sesiones)
    .where(
      and(
        eq(sesiones.tokenHash, hashSessionId(sessionId)),
        isNull(sesiones.revokedAt),
        gt(sesiones.expiresAt, now)
      )
    )
    .limit(1)

  return Boolean(row)
}

/** Marca la sesión como revocada; si ya lo estaba, conserva la fecha original. */
export async function revokeSession(
  sessionId: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(sesiones)
    .set({ revokedAt: now })
    .where(
      and(eq(sesiones.tokenHash, hashSessionId(sessionId)), isNull(sesiones.revokedAt))
    )
}
