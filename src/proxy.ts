import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session'

// Rutas que no requieren autenticación
const PUBLIC_ROUTES = ['/login']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)

  // Verificar si el token de sesión es válido
  let isAuthenticated = false
  if (sessionCookie?.value) {
    try {
      await verifySessionToken(sessionCookie.value)
      isAuthenticated = true
    } catch {
      // Token inválido o expirado — tratar como no autenticado
    }
  }

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)

  // Usuario autenticado intentando acceder a /login → redirigir a /dashboard
  if (isAuthenticated && isPublicRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Usuario no autenticado intentando acceder a ruta privada → redirigir a /login
  if (!isAuthenticated && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Ejecutar el proxy en todas las rutas EXCEPTO:
     * - api y api/* (rutas API; no excluye prefijos como /apiario)
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico, sitemap.xml, robots.txt (archivos de metadatos)
     * - imágenes servidas desde public/ (svg, png, jpg, jpeg, gif, webp, ico)
     */
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$|sitemap\\.xml$|robots\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

