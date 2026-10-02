'use server'

import { redirect } from 'next/navigation'
import { deleteSessionCookie } from '@/lib/session'

export async function logoutAction() {
  await deleteSessionCookie()
  redirect('/login')
}

