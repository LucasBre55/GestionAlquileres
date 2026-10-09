import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/session/expired/route'

describe('GET /api/session/expired', () => {
  it('redirects to /login and clears the session cookie', async () => {
    const request = new NextRequest('http://localhost:3000/api/session/expired', {
      headers: { cookie: 'session=jwt-con-sesion-revocada' },
    })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
    const cleared = response.cookies.get('session')
    expect(cleared?.value).toBe('')
    expect(response.headers.get('set-cookie')).toMatch(/session=;/)
  })
})
