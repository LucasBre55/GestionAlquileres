@AGENTS.md

# GestionAlquileres

Software de gestión de alquileres para un propietario en Córdoba, Argentina: administrar propiedades, inquilinos, pagos de alquiler, impuestos y gastos, con cálculo automático de ajustes (IPC), mora y rentabilidad neta, y un dashboard de estado general.

> 📖 **Fuente de verdad: [`spec.md`](./spec.md)** (raíz del repo). Contiene el detalle completo de objetivos, stack, modelo de datos, reglas de negocio y el MVP definido. **Cualquier sesión futura debe leerlo antes de tocar código o de decidir arquitectura/reglas de negocio** — no se inventan ni se asumen reglas que no estén ahí. Este `CLAUDE.md` resume ese contenido para uso rápido del día a día; ante cualquier discrepancia, `spec.md` gana.

## Stack técnico confirmado

- **Framework:** Next.js 16.3.4 (App Router), React 19.2.8, TypeScript 5 (strict).
  - ⚠️ Next 16 puede tener breaking changes vs. conocimiento previo del modelo — ver `AGENTS.md` en la raíz: leer `node_modules/next/dist/docs/` antes de escribir código nuevo relacionado a Next.
- **Estilos:** Tailwind CSS 4 (vía `@tailwindcss/postcss`), sin librería de componentes.
- **Base de datos:** PostgreSQL gestionado por Neon (`@neondatabase/serverless`, driver HTTP).
- **ORM:** Drizzle ORM 0.45 + drizzle-kit 0.31 — **instalados pero sin usar todavía** (no hay schema, ni `drizzle.config.ts`, ni migraciones).
- **Storage de archivos:** Vercel Blob (spec §3) — para el contrato en PDF de cada propiedad. Sin instalar/configurar todavía.
- **Auth:** ninguna todavía.
- **Testing:** ninguno instalado todavía.

## Estado actual (2026-09-06)

El repo es, en la práctica, el scaffold de `create-next-app` sin modificar + 2 dependencias agregadas (`drizzle-orm`, `@neondatabase/serverless`) + `src/db/index.ts` (conexión a Neon). No hay:
- Modelo de datos (Usuario, Propiedad, Impuesto, Gasto, Pago) — cero tablas definidas.
- Lógica de negocio (IPC, mora, rentabilidad neta) — cero funciones.
- Auth, ABMs, dashboard — cero UI/rutas propias más allá de la landing default.
- `drizzle.config.ts`, carpeta `migrations/`, `.env.example`.

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
```

No hay comandos de migración todavía porque no existe `drizzle.config.ts`. Una vez creado, lo esperable es:
```bash
npx drizzle-kit generate   # genera migración a partir del schema
npx drizzle-kit migrate    # aplica migraciones contra DATABASE_URL
npx drizzle-kit studio     # explorador visual de la DB
```
No hay `.env.example` — falta documentar qué variables de entorno requiere la app (mínimo `DATABASE_URL`).
No hay test runner instalado — no hay comando de tests todavía.

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
