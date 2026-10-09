/**
 * Rate limiting de intentos de login.
 *
 * Los intentos fallidos se guardan en la tabla `intentos_login`, NO en memoria:
 * las funciones serverless de Vercel no conservan estado entre invocaciones (cada
 * una puede correr en una instancia distinta o recién arrancada), así que un
 * contador en memoria se reiniciaría todo el tiempo y no protegería nada en
 * producción.
 *
 * Mejora futura: no hay limpieza automática de filas viejas, la tabla crece
 * indefinidamente. Con un solo propietario el volumen es insignificante; si
 * alguna vez molesta, borrar filas con `creado_en` anterior a la ventana
 * (por ejemplo desde un cron).
 *
 * La lógica es pura: recibe los timestamps y el "ahora" como parámetros, sin
 * leer el reloj, para poder testear cualquier escenario de tiempo.
 */

export const LOGIN_MAX_ATTEMPTS = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

/** Inicio de la ventana: los intentos estrictamente posteriores a este instante cuentan. */
export function getAttemptWindowStart(now: Date): Date {
  return new Date(now.getTime() - LOGIN_WINDOW_MS)
}

/** true si hay `LOGIN_MAX_ATTEMPTS` o más intentos dentro de la ventana que termina en `now`. */
export function isRateLimited(attempts: readonly Date[], now: Date): boolean {
  const windowStart = getAttemptWindowStart(now).getTime()
  const recentAttempts = attempts.filter((at) => at.getTime() > windowStart)
  return recentAttempts.length >= LOGIN_MAX_ATTEMPTS
}
