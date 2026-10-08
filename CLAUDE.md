@AGENTS.md

# GestionAlquileres

Software de gestión de alquileres para un propietario en Córdoba, Argentina: administrar propiedades, inquilinos, pagos de alquiler, impuestos y gastos, con cálculo automático de ajustes (IPC), mora y rentabilidad neta, y un dashboard de estado general.

> 📖 **Fuente de verdad: [`spec.md`](./spec.md)** (raíz del repo). Contiene el detalle completo de objetivos, stack, modelo de datos, reglas de negocio y el MVP definido. **Cualquier sesión futura debe leerlo antes de tocar código o de decidir arquitectura/reglas de negocio** — no se inventan ni se asumen reglas que no estén ahí. Este `CLAUDE.md` resume ese contenido para uso rápido del día a día; ante cualquier discrepancia, `spec.md` gana.

## Stack técnico confirmado

- **Framework:** Next.js 16.4.0 (App Router), React 19.2.8, TypeScript 5 (strict).
  - ⚠️ Next 16 puede tener breaking changes vs. conocimiento previo del modelo — ver `AGENTS.md` en la raíz: leer `node_modules/next/dist/docs/` antes de escribir código nuevo relacionado a Next.
  - En Next 16 `middleware` pasó a llamarse `proxy`: la protección de rutas vive en `src/proxy.ts`.
- **Estilos:** Tailwind CSS 4 (vía `@tailwindcss/postcss`), sin librería de componentes.
- **Base de datos:** PostgreSQL 16 gestionado por Neon (`@neondatabase/serverless`, driver HTTP).
- **ORM:** Drizzle ORM 0.45 + drizzle-kit 0.31. Schema en `src/db/schema.ts`, migraciones en `drizzle/`, config en `drizzle.config.ts`.
- **Storage de archivos:** Vercel Blob (spec §3), modo privado, para el contrato en PDF de cada propiedad. Helpers en `src/lib/blob.ts` (todavía sin uso desde la UI).
- **Auth:** propia, sin librería de auth. Password con `bcryptjs` (12 rondas), sesión como JWT HS256 firmado con `jose` (`JWT_SECRET`) en cookie `session`.
- **Testing:** Vitest 5. Los tests de integración usan un Postgres 16 local vía `docker-compose.test.yml` (`pg` + `drizzle-orm/node-postgres`), nunca Neon.

## Estado actual (2026-10-08)

Hecho:
- **Modelo de datos** (#4, #5): las 6 tablas (`usuarios`, `propiedades`, `ajustes_alquiler`, `impuestos`, `gastos`, `pagos`) con su migración inicial. Seed de datos de prueba en `src/db/seed.ts` (`npm run seed`).
- **Autenticación** (épica #8, #9–#13):
  - Creación del propietario por CLI: `scripts/create-user.ts` (upsert por email, documentado en el README).
  - Login: `src/app/login/page.tsx` + `src/components/LoginForm.tsx` → server action `loginAction` en `src/app/actions/auth.ts`, con error genérico "Credenciales inválidas".
  - Sesión: `src/lib/session.ts`. JWT de 7 días, cookie `httpOnly`, `sameSite: 'strict'`, `secure` solo en producción.
  - Protección de rutas: `src/proxy.ts`. Solo `/login` es pública. Excluye `api`, `_next/static`, `_next/image` y los archivos de metadata.
  - Logout: `src/app/actions/logout.ts`. Solo borra la cookie (sesión stateless, sin invalidación del lado del servidor).
- **Testing** (épica #14, #15–#17): Vitest, Postgres de test en Docker y reseteo con `TRUNCATE` entre tests (`src/test/`).

Pendiente:
- Lógica de negocio (IPC, mora, rentabilidad neta): cero funciones.
- ABMs y dashboard real: `/dashboard` es un placeholder, y `/` sigue siendo la landing de `create-next-app`.
- Deuda técnica abierta: #29 (esbuild vulnerable vía drizzle-kit), #32 (separar tests unit/integration).

## Convenciones del proyecto

Con tan poco código propio, no hay convenciones "descubiertas" todavía — las que siguen son las que trae el scaffold y deberían mantenerse:

- Alias de imports: `@/*` → `./src/*` (ver `tsconfig.json`).
- App Router: código de rutas en `src/app/**`, cada ruta con su carpeta (`page.tsx`, `layout.tsx`).
- DB: cliente Drizzle centralizado en `src/db/index.ts` (patrón a extender, no duplicar conexiones).
- Lint: `eslint-config-next` (core-web-vitals + typescript). Correr `npm run lint` antes de commitear.
- Sin convención de nombres de carpetas para modelos/lógica de negocio todavía — a definir en el primer PR de modelo de datos (sugerido: `src/db/schema.ts` o `src/db/schema/*.ts`, `src/lib/` para lógica de cálculo).

## Comandos

```bash
npm run dev      # servidor de desarrollo (Next.js, puerto 3000)
npm run build    # build de producción
npm run start    # servidor de producción
npm run lint     # eslint
npm run seed     # carga datos de prueba (contra DATABASE_URL)
npm run test     # vitest en modo watch
npm run test:run # vitest una sola vez (requiere el contenedor de docker-compose.test.yml levantado)
npm run verify   # tsc --noEmit + eslint + vitest run
```

Migraciones:
```bash
npx drizzle-kit generate   # genera migración a partir del schema
npx drizzle-kit migrate    # aplica migraciones contra DATABASE_URL
npx drizzle-kit studio     # explorador visual de la DB
```
Variables de entorno documentadas en `.env.example`. ⚠️ `JWT_SECRET` (obligatoria para login y `src/proxy.ts`) todavía no figura ahí.

## Roadmap priorizado hacia el MVP

Basado en la sección "MVP sugerido" de `spec.md`, reordenado por dependencia técnica real (no se puede calcular deuda/mora sin pagos, no hay pagos sin propiedades, no hay dashboard sin cálculos, etc.).

1. **Infraestructura de datos:**
   - Crear `drizzle.config.ts` y `.env.example` (`DATABASE_URL`, credenciales de Vercel Blob).
   - Definir schema Drizzle completo: Usuario (propietario), Propiedad, **AjusteAlquiler** (historial de montos por período — spec §4, agregado para poder recalcular deuda de meses pasados según §5.7), Impuesto, Gasto, Pago/Movimiento — con todos los campos de la sección 4 de `spec.md` y sus relaciones (Propiedad → AjusteAlquiler, Propiedad → Impuestos, Propiedad → Gastos, Propiedad → Pagos).
   - Generar y correr la migración inicial.
   - Configurar Vercel Blob para el contrato en PDF de Propiedad.

2. **Autenticación:**
   - Login del propietario (único actor con cuenta — el inquilino no tiene login, spec §2). Password hasheada.
   - Proteger todas las rutas de la app detrás del login.

3. **ABMs base** (spec §7, puntos 2-5):
   - ABM de Propiedades (inquilino actual/anterior, contacto, dirección, monto inicial, fechas de contrato, frecuencia de ajuste, contrato en PDF).
   - ABM de Impuestos por propiedad (carga manual, sin recargo por mora).
   - ABM de Gastos por propiedad (categoría, monto, fecha, descripción opcional).
   - Carga de Pagos mensuales (alquiler e impuestos) con método de pago, editables/eliminables con recálculo de deuda al editar (spec §5.7).

4. **Integración de IPC** (spec §5.1, §6.1):
   - Definir qué API usar (ArgentinaDatos o Argly) — confirmar antes cuál trae el desagregado "Alquiler de vivienda" (pregunta abierta en spec §8.2).
   - Job/lógica de actualización del monto vigente cuando se cumple la fecha de ajuste según la frecuencia configurada.
   - Manejar el caso de IPC del mes aún no publicado (mostrar último valor disponible como "provisorio" — spec §5.1, pendiente de confirmar como decisión final).

5. **Cálculos automáticos** (spec §5.2, §5.4):
   - Deuda acumulada con recargo por mora de interés simple sobre la deuda vieja (no compuesto).
   - Imputación de pagos parciales: primero a deuda vieja, el resto al mes corriente.
   - Rentabilidad neta por propiedad: `alquiler_cobrado - impuestos - gastos`.

6. **Dashboard** (spec §5.6, §7 punto 9):
   - Indicadores visuales (sin notificaciones activas): deuda pendiente por propiedad, impuestos por vencer, próximos aumentos por IPC, contratos por vencer, rentabilidad neta.

7. **Exportación** (spec §5.8, §7 punto 10):
   - Export a Excel/CSV de pagos, deuda y/o rentabilidad neta.

8. **Endurecimiento:**
   - Tests (elegir runner — Vitest es lo más natural con Next 16 + TS), especialmente sobre los cálculos de mora/IPC/rentabilidad.
   - Validación de inputs (ej. Zod) en ABMs.

**Fuera de alcance del MVP** (spec §7 "Para una v2"): notificaciones email/push, login de inquilino, reportes históricos/proyecciones, multi-propietario.

## Reglas de negocio

Resumen operativo — el detalle completo y las preguntas abiertas están en `spec.md` §5.

- **Aumento por IPC** (§5.1): se usa el IPC específico de "Alquiler de vivienda" (no el general). `nuevo_monto = monto_anterior * (1 + IPC_acumulado_periodo / 100)`. Se recalcula automáticamente al cumplirse la fecha de ajuste según la frecuencia configurada por propiedad (ej. cada 3/4/6 meses) — el propietario no lo actualiza a mano.
- **Deuda y mora** (§5.2): si el inquilino paga de menos (o no paga), la diferencia pasa a deuda del mes siguiente. El recargo por mora es **interés simple**: se calcula solo sobre la deuda adeudada, nunca sobre recargos previos (no compuesto). ⚠️ **La tasa exacta y su periodicidad todavía no están definidas** (spec §5.2/§8.3) — implementar como parámetro configurable, nunca hardcodear un valor.
- **Imputación de pagos parciales** (§5.2): un pago parcial se aplica primero a la **deuda vieja**; el excedente, si lo hay, se imputa al mes corriente.
- **Impuestos** (§5.3): monto y periodicidad propios por impuesto, carga manual (no hay API pública para estos datos), **nunca generan recargo por mora**, quedan "pendientes" hasta que el propietario los marca como pagados.
- **Gastos** (§5.4): siempre a cargo del propietario, sin vínculo con el inquilino ni con la deuda de alquiler.
- **Rentabilidad neta** (§5.4): `rentabilidad_neta = alquiler_cobrado - impuestos - gastos`.
- **Edición de pagos** (§5.7): el propietario puede editar/eliminar un pago cargado por error; el sistema debe recalcular la deuda acumulada de la propiedad en base al nuevo estado.
- **Sin notificaciones activas** (§5.6): solo indicadores visuales en el dashboard (deuda, vencimientos de impuestos, próximos aumentos IPC, vencimientos de contrato).
- **Exportación** (§5.8): a Excel/CSV para uso externo (ej. contador).

**Abierto todavía** (spec §8):
- Qué hacer si el IPC del mes exacto aún no fue publicado por INDEC (no bloqueante para el schema, sí antes de integrar IPC).
- Cuál API (ArgentinaDatos vs. Argly) trae el desagregado de "Alquiler de vivienda" (no bloqueante para el schema, sí antes de integrar IPC).
- **Tasa y periodicidad del recargo por mora** — sí es relevante para el schema: modelar la tasa como campo/parámetro configurable, no como constante en código.
