'use server'

import { and, eq, gt } from 'drizzle-orm'
import { compare } from 'bcryptjs'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { intentosLogin, usuarios } from '@/db/schema'
import { getAttemptWindowStart, isRateLimited } from '@/lib/rate-limit'
import { createSessionToken, createSessionCookie } from '@/lib/session'
import { generateSessionId } from '@/lib/session-id'
import { createSessionRecord } from '@/lib/session-store'
import { getSafeRedirectPath } from '@/lib/safe-redirect'

export type LoginState = {
  success: boolean
  error: string
}

const INVALID_CREDENTIALS_MSG = 'Credenciales inválidas'
const RATE_LIMITED_MSG = 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.'

// Hash bcrypt fijo y no secreto (12 rondas, mismo costo que scripts/create-user.ts).
// Nunca se compara contra una contraseña real: existe solo para que
// bcrypt.compare() cueste lo mismo cuando el usuario no existe. Está escrito
// como literal para evitar ~250ms de hashSync() en cada cold start. Generado con:
//   node -e "console.log(require('bcryptjs').hashSync('dummy-password-never-used', 12))"
const DUMMY_PASSWORD_HASH =
  '$2b$12$XJ7Z/.1CMe4LPFml66aEvu4VilH58vsPf8SG677oiLKrK0uc5W8i6'

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const rawEmail = formData.get('email')
  const password = formData.get('password')

  // Chequeo básico de presencia de datos — mismo error genérico para todo
  if (
    typeof rawEmail !== 'string' ||
    typeof password !== 'string' ||
    !rawEmail ||
    !password
  ) {
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Misma normalización que scripts/create-user.ts, que guarda los emails en minúsculas
  const email = rawEmail.trim().toLowerCase()

  // Rate limit ANTES de cualquier trabajo con bcrypt (real o dummy). Se cuenta por
  // email normalizado, exista o no la cuenta, así un email bloqueado no revela nada.
  // Trade-off: limitar por email protege contra fuerza bruta, pero cualquiera que
  // conozca el email del propietario puede bloquearlo 15 minutos fallando a propósito.
  // Aceptado para este proyecto (un solo usuario legítimo, sin terceros afectados).
  // Si en el futuro se agregan usuarios reales, reevaluar combinándolo con un límite por IP.
  const now = new Date()
  const recentAttempts = await db
    .select({ creadoEn: intentosLogin.creadoEn })
    .from(intentosLogin)
    .where(
      and(
        eq(intentosLogin.email, email),
        gt(intentosLogin.creadoEn, getAttemptWindowStart(now))
      )
    )

  if (
    isRateLimited(
      recentAttempts.map((attempt) => attempt.creadoEn),
      now
    )
  ) {
    return { success: false, error: RATE_LIMITED_MSG }
  }

  // Buscar el usuario por email con Drizzle ORM
  const [user] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.email, email))

  // Correr siempre exactamente un bcrypt compare, contra un hash dummy si el usuario
  // no existe, para que el tiempo de respuesta no revele si el email está registrado
  const passwordMatch = await compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  )

  if (!user || !passwordMatch) {
    // Registrar el fallo para todo email (exista o no) así el conteo es idéntico
    await db.insert(intentosLogin).values({ email })
    // Usuario inexistente o contraseña incorrecta — devolver el MISMO error genérico
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Un login exitoso reinicia el contador de este email
  await db.delete(intentosLogin).where(eq(intentosLogin.email, email))

  // Credenciales válidas — persistir la sesión (solo su hash), crear el JWT con el
  // identificador sin hashear y redirigir
  const sessionId = generateSessionId()
  await createSessionRecord({
    usuarioId: user.id,
    sessionId,
    now: new Date(),
  })
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    sessionId,
  })
  await createSessionCookie(token)

  // `from` viene del cliente: solo se acepta si es una ruta interna
  redirect(getSafeRedirectPath(formData.get('from')) ?? '/dashboard')
}
