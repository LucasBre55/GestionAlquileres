'use client'

import { useActionState } from 'react'
import { loginAction, type LoginState } from '@/app/actions/auth'

const initialState: LoginState = {
  success: false,
  error: '',
}

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <form action={formAction} className="space-y-5">
      {/* Email */}
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          placeholder="tu@email.com"
        />
      </div>

      {/* Password */}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          placeholder="••••••••"
        />
      </div>

      {/* Error message */}
      {state.error && (
        <p
          aria-live="polite"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
        >
          {state.error}
        </p>
      )}

      {/* Success message (temporary, until session handling is implemented) */}
      {state.success && (
        <p
          aria-live="polite"
          className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2"
        >
          Inicio de sesión exitoso
        </p>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </button>
    </form>
  )
}

