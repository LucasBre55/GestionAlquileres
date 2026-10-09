'use server'

import { eq } from 'drizzle-orm'
import { compare } from 'bcryptjs'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { usuarios } from '@/db/schema'
import { createSessionToken, createSessionCookie } from '@/lib/session'
import { getSafeRedirectPath } from '@/lib/safe-redirect'

export type LoginState = {
  success: boolean
  error: string
}

const INVALID_CREDENTIALS_MSG = 'Credenciales inválidas'

// Fixed, non-secret bcrypt hash (12 rounds, same cost as scripts/create-user.ts).
// It is never compared against a real password: it only exists so that
// bcrypt.compare() costs the same when the user does not exist. Hardcoded to
// avoid ~250ms of hashSync() on every cold start. Generated with:
//   node -e "console.log(require('bcryptjs').hashSync('dummy-password-never-used', 12))"
const DUMMY_PASSWORD_HASH =
  '$2b$12$XJ7Z/.1CMe4LPFml66aEvu4VilH58vsPf8SG677oiLKrK0uc5W8i6'

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const rawEmail = formData.get('email')
  const password = formData.get('password')

  // Basic input presence check — same generic error for everything
  if (
    typeof rawEmail !== 'string' ||
    typeof password !== 'string' ||
    !rawEmail ||
    !password
  ) {
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Same normalization as scripts/create-user.ts, which stores emails lowercased
  const email = rawEmail.trim().toLowerCase()

  // Look up user by email via Drizzle ORM
  const [user] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.email, email))

  // Always run exactly one bcrypt compare, against a dummy hash when the user
  // does not exist, so response time does not reveal whether the email is registered
  const passwordMatch = await compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  )

  if (!user || !passwordMatch) {
    // User not found or wrong password — return the SAME generic error
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Credentials valid — create session and redirect
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
  })
  await createSessionCookie(token)

  // `from` viene del cliente: solo se acepta si es una ruta interna
  redirect(getSafeRedirectPath(formData.get('from')) ?? '/dashboard')
}
