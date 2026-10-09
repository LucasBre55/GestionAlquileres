'use server'

import { redirect } from 'next/navigation'
import { deleteSessionCookie, getSession } from '@/lib/session'
import { hashSessionId } from '@/lib/session-id'
import { revokeSession } from '@/lib/session-store'

export async function logoutAction() {
  try {
    // Revocar en la base antes de borrar la cookie, así el JWT deja de servir aunque
    // alguien lo haya copiado. Sin sesión válida (o con un JWT previo a la tabla
    // `sesiones`, sin sessionId) no hay nada que revocar.
    const session = await getSession()
    if (session?.sessionId) {
      try {
        await revokeSession(session.sessionId)
      } catch (error) {
        // No se relanza: el usuario igual debe terminar deslogueado en /login. La
        // sesión queda sin revocar en la base, por eso se registra el fallo. Se loguea
        // el hash (token_hash de la fila) y nunca el sessionId sin hashear, que es la
        // credencial y no debe quedar en texto plano en los logs.
        console.error('logoutAction: no se pudo revocar la sesión', {
          tokenHash: hashSessionId(session.sessionId),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    // La cookie se borra siempre, también si getSession() falla
    await deleteSessionCookie()
  }
  redirect('/login')
}
