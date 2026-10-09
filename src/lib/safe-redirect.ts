const PLACEHOLDER_ORIGIN = 'http://internal.invalid'

/**
 * Valida el valor de `?from=` usado para volver a la ruta original tras el login.
 * Devuelve una ruta interna segura (path + query) o null si el valor no es
 * un string o apunta fuera de la app (URL absoluta, `//host`, `/\host`, etc.).
 *
 * Se parsea con URL en vez de chequear solo el prefijo "/": los navegadores
 * tratan `/\host` y `/<tab>/host` como `//host`, y el parser lo detecta porque
 * el origin resultante deja de ser el placeholder.
 */
export function getSafeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return null
  }

  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return null
  }

  if (url.origin !== PLACEHOLDER_ORIGIN) {
    return null
  }

  // Volver a /login desde /login no tiene sentido
  if (url.pathname === '/login') {
    return null
  }

  return url.pathname + url.search
}
