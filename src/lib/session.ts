import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const SESSION_COOKIE_NAME = 'session'
const SESSION_DURATION_DAYS = 7

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'La variable de entorno JWT_SECRET no está definida. Configúrala en el archivo .env'
    )
  }
  return new TextEncoder().encode(secret)
}

export type SessionPayload = {
  userId: number
  email: string
}

/**
 * Genera un JWT firmado con el payload de sesión del usuario.
 * Expira en 7 días.
 */
export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(getSecretKey())
}

/**
 * Verifica y decodifica un JWT de sesión.
 * Lanza un error si el token es inválido o expiró.
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: ['HS256'],
  })
  return payload as unknown as SessionPayload
}

/**
 * Crea la cookie de sesión con atributos de seguridad estrictos.
 */
export async function createSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  const expires = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  )

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires,
    path: '/',
  })
}

/**
 * Elimina la cookie de sesión (para logout).
 */
export async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

/**
 * Lee y verifica la sesión actual desde la cookie.
 * Retorna null si no hay sesión o el token es inválido.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)

  if (!sessionCookie?.value) {
    return null
  }

  try {
    return await verifySessionToken(sessionCookie.value)
  } catch {
    return null
  }
}

