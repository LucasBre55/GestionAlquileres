import { redirect } from 'next/navigation'
import { getSession, type SessionPayload } from '@/lib/session'
import { isSessionActive } from '@/lib/session-store'

// Ruta que limpia la cookie y recién después manda a /login: redirigir directo a /login
// con una cookie de firma válida haría un loop con el proxy (ver route.ts).
const EXPIRED_SESSION_PATH = '/api/session/expired'

/**
 * Exige una sesión válida y activa, o redirige. El proxy es un chequeo optimista (solo
 * firma y expiración del JWT) y los layouts no cubren las server actions, que son
 * endpoints públicos: cada acción protegida debe llamar a esto.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()

  if (!session || !(await isSessionActive(session.sessionId))) {
    redirect(EXPIRED_SESSION_PATH)
  }

  return session
}
