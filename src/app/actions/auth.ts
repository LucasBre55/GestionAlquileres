'use server'

import { eq } from 'drizzle-orm'
import { compare } from 'bcryptjs'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { usuarios } from '@/db/schema'
import { createSessionToken, createSessionCookie } from '@/lib/session'

export type LoginState = {
  success: boolean
  error: string
}

const INVALID_CREDENTIALS_MSG = 'Credenciales inválidas'

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get('email')
  const password = formData.get('password')

  // Basic input presence check — same generic error for everything
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email ||
    !password
  ) {
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Look up user by email via Drizzle ORM
  const [user] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.email, email))

  if (!user) {
    // User not found — return the SAME generic error
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Compare submitted password against the stored hash
  const passwordMatch = await compare(password, user.passwordHash)

  if (!passwordMatch) {
    // Wrong password — return the SAME generic error
    return { success: false, error: INVALID_CREDENTIALS_MSG }
  }

  // Credentials valid — create session and redirect
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
  })
  await createSessionCookie(token)

  redirect('/dashboard')
}

