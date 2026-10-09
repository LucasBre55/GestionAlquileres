import LogoutButton from '@/components/LogoutButton'
import { requireSession } from '@/lib/require-session'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // El proxy es un chequeo optimista (solo firma y expiración del JWT): revalidar la
  // sesión cerca de los datos, confirmando que siga en la base sin revocar ni expirar.
  const session = await requireSession()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <h1 className="text-lg font-semibold text-gray-900">
            Gestión de Alquileres
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{session.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}

