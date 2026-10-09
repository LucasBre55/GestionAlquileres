import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/session'

/**
 * Destino del layout del dashboard cuando el JWT tiene firma válida pero la sesión
 * fue revocada o expiró en la base. Borra la cookie y manda a /login.
 *
 * Hace falta porque el proxy solo verifica el JWT: con la cookie intacta, un
 * redirect directo a /login rebotaría de nuevo a /dashboard (loop). Vive bajo
 * /api, que el matcher del proxy excluye, y un Server Component no puede borrar
 * cookies, por eso es un Route Handler. Solo borra la cookie de quien lo llama.
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url))
  response.cookies.delete(SESSION_COOKIE_NAME)
  return response
}
