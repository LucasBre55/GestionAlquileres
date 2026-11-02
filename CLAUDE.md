@AGENTS.md

# GestionAlquileres

Software de gestión de alquileres para un propietario en Córdoba, Argentina: administrar propiedades, inquilinos, pagos de alquiler, impuestos y gastos, con cálculo automático de ajustes (IPC), mora y rentabilidad neta, y un dashboard de estado general.

> 📖 **Fuente de verdad: [`spec.md`](./spec.md)** (raíz del repo). Contiene el detalle completo de objetivos, stack, modelo de datos, reglas de negocio y el MVP definido. **Cualquier sesión futura debe leerlo antes de tocar código o de decidir arquitectura/reglas de negocio** — no se inventan ni se asumen reglas que no estén ahí. Este `CLAUDE.md` resume ese contenido para uso rápido del día a día; ante cualquier discrepancia, `spec.md` gana.

## Stack técnico confirmado

- **Framework:** Next.js 16.4.0 (App Router), React 19.2.8, TypeScript 5 (strict).
  - ⚠️ Next 16 puede tener breaking changes vs. conocimiento previo del modelo — ver `AGENTS.md` en la raíz: leer `node_modules/next/dist/docs/` antes de escribir código nuevo relacionado a Next.
  - En Next 16 `middleware` pasó a llamarse `proxy`: la protección de rutas vive en `src/proxy.ts`.
- **Estilos:** Tailwind CSS 4 (vía `@tailwindcss/postcss`), sin librería de componentes.
- **Base de datos:** PostgreSQL 16 gestionado por Neon (`@neondatabase/serverless`). Dos clientes: `db` en `src/db/index.ts` (`neon-http`, sin transacciones, el de las lecturas y los UPDATE de una sola sentencia) y `withTransaction()` en `src/db/transaction.ts` (`neon-serverless` por WebSocket, abre y cierra un `Pool` por llamada, para operaciones de varias sentencias). Ambos se pasan a la lógica de negocio como `DbExecutor` (`src/db/executor.ts`).
- **Validación:** `zod` 4. Ojo: `.omit()`/`.pick()` lanzan sobre un objeto con refinamientos; derivar de un objeto base sin refinar.
- **ORM:** Drizzle ORM 0.45 + drizzle-kit 0.31. Schema en `src/db/schema.ts`, migraciones en `drizzle/`, config en `drizzle.config.ts`.
- **Storage de archivos:** Vercel Blob (spec §3), modo privado, para el contrato en PDF de cada propiedad. Helpers en `src/lib/blob.ts` (todavía sin uso desde la UI).
- **Auth:** propia, sin librería de auth. Password con `bcryptjs` (12 rondas), sesión como JWT HS256 firmado con `jose` (`JWT_SECRET`) en cookie `session`.
- **Testing:** Vitest 5. Los tests de integración usan un Postgres 16 local vía `docker-compose.test.yml` (`pg` + `drizzle-orm/node-postgres`), nunca Neon.

## Estado actual (2026-11-01)

Hecho:
- **Modelo de datos** (#4, #5): las 6 tablas de negocio (`usuarios`, `propiedades`, `ajustes_alquiler`, `impuestos`, `gastos`, `pagos`) con su migración inicial, más `intentos_login` (rate limiting, migración `0001`) y `sesiones` (invalidación de sesión, migración `0002`). Seed de datos de prueba en `src/db/seed.ts` (`npm run seed`).
- **Autenticación** (épica #8, #9–#13):
  - Creación del propietario por CLI: `scripts/create-user.ts` (upsert por email, documentado en el README).
  - Login: `src/app/login/page.tsx` + `src/components/LoginForm.tsx` → server action `loginAction` en `src/app/actions/auth.ts`, con error genérico "Credenciales inválidas". El email se normaliza (`trim` + `toLowerCase`) igual que en `scripts/create-user.ts`. Siempre corre un único `bcrypt.compare()` (contra un hash dummy constante si el usuario no existe) para no revelar por timing qué emails están registrados.
  - Rate limiting (#39): antes de tocar bcrypt, `loginAction` cuenta los fallos del email normalizado en los últimos 15 minutos (tabla `intentos_login`); con 5 o más responde "Demasiados intentos…" sin comparar nada. Cada fallo se registra exista o no el usuario (el conteo es idéntico) y un login exitoso borra los intentos del email. La ventana es lógica pura en `src/lib/rate-limit.ts` (`isRateLimited(attempts, now)`, el "ahora" se inyecta). Estado en la base y no en memoria porque las funciones serverless de Vercel no lo conservan. Trade-off aceptado: quien conozca el email del propietario puede bloquearlo 15 minutos; si se suman usuarios reales, reevaluar con un límite por IP. Sin limpieza automática de filas viejas (mejora futura).
  - Sesión: `src/lib/session.ts` es la única fuente de verdad (nombre de cookie `SESSION_COOKIE_NAME`, `getSecretKey()` privada, `verifySessionToken()` con `algorithms: ['HS256']` fijo). JWT de 7 días, cookie `httpOnly`, `sameSite: 'strict'`, `secure` solo en producción. El payload lleva `sessionId`.
  - Invalidación server-side (#40): el JWT sigue siendo la credencial, pero la tabla `sesiones` es la fuente de verdad adicional. `loginAction` genera un identificador aleatorio (`generateSessionId()`, 256 bits), guarda solo su hash SHA-256 (`hashSessionId()`, `src/lib/session-id.ts`) y mete el identificador sin hashear en el JWT; el hash nunca viaja. Las operaciones de base están en `src/lib/session-store.ts` (`createSessionRecord`, `isSessionActive`, `revokeSession`). Una sesión es válida si existe, `revoked_at` es null y `expires_at` es futuro. Los JWT emitidos antes de la tabla no traen `sessionId` y quedan inválidos. Sin limpieza automática de filas viejas (mejora futura).
  - Protección de rutas: `src/proxy.ts` (chequeo optimista, verifica con `verifySessionToken()`, sin `jwtVerify` propio). Solo `/login` es pública. El matcher excluye `api` y `api/*` (no prefijos como `/apiario`), `_next/static`, `_next/image`, metadata e imágenes de `public/`. Al redirigir a `/login` agrega `?from=<ruta original>`.
  - Ruta original tras login: `loginAction` redirige a `from` solo si pasa `getSafeRedirectPath()` (`src/lib/safe-redirect.ts`: ruta interna parseada con `URL`, contra open redirect); si no, a `/dashboard`.
  - Revalidación server-side: `src/app/dashboard/layout.tsx` valida el JWT (`getSession()`) y además `isSessionActive()` contra la base; no se confía solo en el proxy. Si falla redirige a `/api/session/expired` (Route Handler que borra la cookie y manda a `/login`), no directo a `/login`: el proxy solo mira la firma, así que con la cookie intacta rebotaría `/login` → `/dashboard` en loop. Vive bajo `/api`, que el matcher excluye.
  - Logout: `src/app/actions/logout.ts` revoca la fila de `sesiones` y borra la cookie. Si la revocación falla, loguea el hash (nunca el `sessionId` sin hashear) y redirige igual a `/login`; la sesión queda sin revocar en la base.
  - Reseteo de contraseña: `scripts/create-user.ts` revoca todas las sesiones activas del usuario (sin test, es un script interactivo).
  - UI: tema claro único (sin `prefers-color-scheme` en `globals.css`) y `lang="es"` en el root layout. `/` redirige a `/dashboard` o `/login` según haya sesión.
- **Testing** (épica #14, #15–#17): Vitest, Postgres de test en Docker y reseteo con `TRUNCATE` entre tests (`src/test/`).
- **ABM de Propiedades** (épica #45), hecha la capa de servidor completa (#46 a #49); falta la UI:
  - Cliente transaccional (#46): `withTransaction()` en `src/db/transaction.ts` y el tipo `DbExecutor` (`src/db/executor.ts`).
  - Crear (#47): `crearPropiedadAction` en `src/app/actions/propiedades.ts` → `crearPropiedad(tx, propietarioId, datos)` en `src/lib/crear-propiedad.ts`. Inserta la propiedad y su primer `ajustes_alquiler` (monto inicial, vigente desde el inicio del contrato) en una transacción.
  - Editar (#48): `editarPropiedadAction` → `editarPropiedad(executor, propietarioId, propiedadId, datos)` en `src/lib/editar-propiedad.ts`. Solo edita `inquilino_actual`, `contacto_inquilino`, `direccion`, `fecha_fin_contrato` y `frecuencia_aumento`; `monto_inicial` y `fecha_inicio_contrato` quedan fijos (son el punto de partida del historial de ajustes), y estado y contrato tienen sus propias acciones. Un único UPDATE con `CASE` mueve el inquilino viejo a `inquilino_anterior` solo si había uno y cambia (vaciar la propiedad conserva el anterior que hubiera). Valida `fecha_fin > fecha_inicio` contra la fecha de inicio **guardada** (el formulario no la envía). Propiedad ajena e inexistente devuelven el mismo resultado (`no_encontrada`).
  - Esquemas en `src/lib/propiedad-schema.ts`, sin imports de servidor para que los reuse la UI: objeto base sin refinar, `crearPropiedadSchema` (con el refinamiento fin > inicio), `editarPropiedadSchema` (sin monto ni fecha de inicio, sin refinamiento) y `propiedadIdSchema`. Cada acción tiene su whitelist de campos (`CAMPOS_PROPIEDAD`, `CAMPOS_EDITAR_PROPIEDAD`): el resto del FormData se ignora.
  - `editarPropiedad` se verificó además contra Neon real con el cliente `neon-http` (traspaso A→B→null→C y ownership), con un script temporal que ya no está en el repo.
  - Cambiar estado (#49): `cambiarEstadoPropiedadAction` → `cambiarEstadoPropiedad(executor, propietarioId, propiedadId, estado)` en `src/lib/cambiar-estado-propiedad.ts`. Un único UPDATE de `estado` filtrado por id y propietario; pasar al mismo estado es OK. El esquema (`cambiarEstadoSchema`, `ESTADOS_PROPIEDAD`) vive en `src/lib/propiedad-schema.ts` y un test lo compara con el pgEnum de `src/db/schema.ts`.
  - Eliminar (#49): `eliminarPropiedadAction` → `eliminarPropiedad(executor, propietarioId, propiedadId)` en `src/lib/eliminar-propiedad.ts`. Hard delete (la cascada la define el schema). Lee la propiedad con filtro de dueño, borra el contrato en Blob (`eliminarContratoPDF`, `src/lib/blob.ts`) y recién después la fila. Solo `BlobNotFoundError` (por `instanceof`) cuenta como éxito; cualquier otro fallo de Blob o de la base aborta y la action responde `errors.general` y loguea clase y mensaje, nunca el token. Si la base falla tras borrar el archivo queda un `contrato_pdf_url` roto que se arregla reintentando: la UI de #52 debe tolerarlo. La confirmación previa es responsabilidad de la UI.
  - Cada server action empieza con `requireSession()` (`src/lib/require-session.ts`: JWT + `isSessionActive()`, redirige a `/api/session/expired`); el `propietario_id` sale siempre de la sesión, nunca del FormData.

Pendiente:
- Lógica de negocio (IPC, mora, rentabilidad neta): cero funciones.
- ABM de Propiedades: falta la UI: #50 (listado), #51 (formulario de alta y edición), #52 (detalle y subida de contrato). Pendiente también la verificación de #49 contra Neon y Blob reales (solo está cubierta por tests contra el Postgres local con Blob mockeado). El resto de los ABMs (impuestos, gastos, pagos) y el dashboard real no empezaron: `/dashboard` es un placeholder.
- Hardening de autenticación (épica #36, reemplaza la deuda técnica #34): hechas #37 (scaffold + redirect), #38 (timing attack), #39 (rate limiting) y #40 (invalidación de sesión server-side). Pendiente: la verificación manual del flujo completo en un navegador (login, logout, reseteo de contraseña y el redirect de sesión revocada), que solo está cubierto por tests y el build. Al desplegar, aplicar las migraciones a Neon (`npx drizzle-kit migrate`) y volver a iniciar sesión una vez.
- Deuda técnica abierta: #29 (esbuild vulnerable vía drizzle-kit), #32 (separar tests unit/integration).

## Convenciones del proyecto

Las primeras convenciones vienen del scaffold; las de lógica de negocio y server actions se fueron fijando con el ABM de Propiedades y deberían mantenerse:

- Alias de imports: `@/*` → `./src/*` (ver `tsconfig.json`).
- App Router: código de rutas en `src/app/**`, cada ruta con su carpeta (`page.tsx`, `layout.tsx`).
- DB: cliente Drizzle centralizado en `src/db/index.ts` (patrón a extender, no duplicar conexiones).
- Lint: `eslint-config-next` (core-web-vitals + typescript). Correr `npm run lint` antes de commitear.
- Server actions en dos capas: la action (`src/app/actions/*.ts`) hace `requireSession()`, lee solo los campos de su whitelist, valida con zod **antes** de tocar la base y devuelve `{ success, errors }` por campo (compatible con `useActionState`, sin `redirect` ni `revalidatePath`); la lógica vive en `src/lib/` y recibe un `DbExecutor` como parámetro, sin abrir transacciones ella misma.
- Toda server action empieza con `requireSession()` y toma el `propietario_id` de la sesión (`session.userId`), nunca del FormData.
- Todo `UPDATE` o `DELETE` sobre `propiedades` lleva el filtro por `propietario_id` en su propio `WHERE`, aunque una lectura previa ya lo haya filtrado. Propiedad ajena e inexistente responden igual.
- Al borrar una propiedad con contrato, el archivo en Blob se borra **antes** que la fila: si Blob falla, la fila queda intacta y se reintenta; al revés quedaría un archivo huérfano e invisible.
- Tests de integración (`*.integration.test.ts`) contra el Postgres de test. Las actions importan `db` (Neon) al cargarse, que falla sin `DATABASE_URL`: mockear `@/db` apuntando a `testDb` (`src/db/test-client.ts`).
- Fechas ISO (`YYYY-MM-DD`) se comparan como string, nunca con `Date` (corre el día según la zona horaria); montos como string, sin `parseFloat`.
- Mensajes de error de validación y textos de UI en español neutro; código e identificadores de lógica en español (`crearPropiedad`, `fechaFinContrato`), como el resto del dominio.

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
Variables de entorno documentadas en `.env.example`. `JWT_SECRET` (obligatoria para login y `src/proxy.ts`) también figura ahí, con cómo generarla.

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
