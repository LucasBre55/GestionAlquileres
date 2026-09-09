This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# GestionAlquileres

## Crear el usuario propietario

La aplicación no tiene registro público: el único usuario con cuenta es el propietario, y se
crea desde la línea de comandos.

```bash
npx tsx --env-file=.env.local scripts/create-user.ts
```

> Si tus variables están en `.env` en lugar de `.env.local`, usá `--env-file=.env`. El script
> también toma `DATABASE_URL` del entorno del sistema si ya está definida.

El script pide los datos de forma interactiva:

1. **Email** — se normaliza a minúsculas.
2. **Nombre** — solo se pide cuando el usuario no existe todavía.
3. **Contraseña** (mínimo 8 caracteres) y su confirmación — no se muestran al tipear, así no
   quedan en pantalla, en el scrollback ni en el historial de la shell.

Nunca pases la contraseña como argumento: quedaría visible en el historial y en la lista de
procesos del sistema.

El comportamiento es **upsert por email**:

- Si el email **no existe**, crea el usuario.
- Si el email **ya existe**, actualiza únicamente su `password_hash` — este es el camino para
  resetear la contraseña.

La contraseña se guarda hasheada con `bcryptjs` (12 rondas). El script confirma al terminar si
creó o actualizó el usuario, sin imprimir nunca la contraseña ni el hash.
