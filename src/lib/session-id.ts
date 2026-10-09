import { createHash, randomBytes } from 'node:crypto'

export const SESSION_DURATION_DAYS = 7

/** Vencimiento de una sesión creada en `now`; lo usan tanto el JWT como la tabla `sesiones`. */
export function getSessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
}

/** Identificador de sesión aleatorio criptográfico (256 bits, hex). Viaja solo dentro del JWT. */
export function generateSessionId(): string {
  return randomBytes(32).toString('hex')
}

/**
 * SHA-256 (hex) del identificador de sesión: lo único que se guarda en la base.
 * Es determinístico, así que sirve para buscar la fila a partir del JWT; como el
 * identificador ya es aleatorio de 256 bits, no hace falta sal.
 */
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}
