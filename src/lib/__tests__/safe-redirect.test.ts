import { describe, expect, it } from 'vitest'
import { getSafeRedirectPath } from '@/lib/safe-redirect'

describe('getSafeRedirectPath', () => {
  it('accepts internal paths, keeping query string', () => {
    expect(getSafeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(getSafeRedirectPath('/dashboard/propiedades?id=3')).toBe(
      '/dashboard/propiedades?id=3'
    )
  })

  it.each([
    'https://sitio-falso.com',
    'http://sitio-falso.com/dashboard',
    '//sitio-falso.com',
    '/\\sitio-falso.com',
    '/\t/sitio-falso.com',
    'javascript:alert(1)',
    'dashboard',
    '',
  ])('rejects %j', (value) => {
    expect(getSafeRedirectPath(value)).toBeNull()
  })

  it('rejects non-string values', () => {
    expect(getSafeRedirectPath(undefined)).toBeNull()
    expect(getSafeRedirectPath(null)).toBeNull()
    expect(getSafeRedirectPath(['/dashboard', '/otra'])).toBeNull()
  })

  it('rejects /login itself to avoid redirect loops', () => {
    expect(getSafeRedirectPath('/login')).toBeNull()
    expect(getSafeRedirectPath('/login?from=/dashboard')).toBeNull()
  })
})
