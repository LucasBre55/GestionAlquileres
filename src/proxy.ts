import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const SESSION_COOKIE_NAME = 'session'

// Rutas que no requieren autenticación
const PUBLIC_ROUTES = ['/login']

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'La variable de entorno JWT_SECRET no está definida. Configúrala en el archivo .env'
    )
  }
  return new TextEncoder().encode(secret)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)

  // Verificar si el token de sesión es válido
  let isAuthenticated = false
  if (sessionCookie?.value) {
    try {
      await jwtVerify(sessionCookie.value, getSecretKey())
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
     * - api (rutas API)
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico, sitemap.xml, robots.txt (archivos de metadatos)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}

