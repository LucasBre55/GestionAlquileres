# Proyecto: Sistema de Gestión de Alquileres

## 1. Descripción general

Software web para un propietario de inmuebles (todos ubicados en la **provincia de Córdoba, Argentina**) que permite:
- Administrar múltiples propiedades alquiladas.
- Llevar el control de pagos de alquiler e impuestos asociados a cada propiedad.
- Registrar gastos propios del dueño (reparaciones, mantenimiento, etc.).
- Calcular automáticamente los aumentos de alquiler según la evolución del IPC.
- Acumular deuda del inquilino cuando no paga, con recargo por mora.
- Mostrar la rentabilidad neta de cada propiedad.

---

## 2. Actores

| Actor | Rol |
|---|---|
| **Propietario** | Usuario registrado que se loguea y administra sus propiedades |
| **Inquilino** | No es usuario del sistema (por ahora), es un dato asociado a la propiedad |

- El sistema es para **un solo propietario** por cuenta (no hay multi-propietario ni condominios, al menos en esta versión).
- Se descartó que el inquilino tenga login propio, ni siquiera para una v2 — no se considera necesario para el objetivo del sistema.

---

## 3. Stack tecnológico

- **Framework**: Next.js
- **Base de datos**: Postgres en la nube, plan gratuito. Se descartó Supabase porque pausa el proyecto por inactividad y requiere reactivarlo manualmente.
  - **Recomendada: Neon** — el cómputo se pausa a los 5 minutos de inactividad, pero se reactiva solo (~1 segundo) apenas llega una consulta nueva, sin intervención manual. Free tier: 100 proyectos, 0.5 GB de storage por proyecto, 100 CU-horas/mes. Tiene integración directa como add-on en Vercel.
  - Alternativa evaluada: Turso (SQLite distribuida) — liviana y con buen soporte para Next.js, válida si el volumen de datos se mantiene chico.
  - Descartadas: MongoDB Atlas M0 (también pausa por inactividad, cada 30 días, con reactivación manual) y PlanetScale (ya no tiene plan gratuito).
- **ORM sugerido**: Drizzle o Prisma. Drizzle tiene mejor soporte para el driver serverless de Neon.
- **Storage de archivos**: Vercel Blob, para el PDF del contrato adjunto a cada propiedad. Plan Hobby gratuito: 1 GB de storage y 10 GB de transferencia por mes (suficiente para este caso de uso). Nota: el plan Hobby es para uso personal/no comercial — está bien mientras la app en sí no se venda ni se monetice.

---

## 4. Modelo de datos propuesto

### Usuario (Propietario)
- id
- nombre
- email
- password (hasheada)

### Propiedad
- id
- propietario_id
- nombre del inquilino actual
- contacto del inquilino (teléfono / email)
- nombre del inquilino anterior *(solo se guarda el último, no un historial completo)*
- dirección
- **monto inicial del alquiler**
- **fecha de inicio del contrato**
- **fecha de fin del contrato** (para alertar sobre vencimientos próximos)
- contrato adjunto (archivo PDF)
- **frecuencia de aumento** (cada cuántos meses se ajusta por IPC — ej. cada 3, 4 o 6 meses)
- monto actual del alquiler (calculado, resultado de aplicar los aumentos)
- deuda acumulada de alquiler
- estado (activa / inactiva, por si el inquilino se va)

### AjusteAlquiler (historial de montos de una propiedad)
- id
- propiedad_id
- monto
- vigente_desde (fecha)

> Necesaria para poder recalcular correctamente la deuda de meses pasados: sin este historial, cualquier recálculo usaría el monto actual (con aumentos de IPC ya aplicados) en vez del monto que realmente estaba vigente en ese mes.

### Impuesto (catálogo de impuestos de una propiedad — NO tiene monto ni estado)
- id
- propiedad_id
- tipo (ABL, expensas, tasas municipales, etc.)
- periodicidad (mensual, bimestral, etc.)

> El monto de un impuesto varía mes a mes (por consumo o por indexación), igual que pasa con el alquiler. Por eso `impuestos` es solo el catálogo de qué impuestos tiene la propiedad — el monto real, la fecha de vencimiento y si se pagó viven en `Pago`, igual que con el alquiler. Es el mismo principio que separar `Propiedad` de `AjusteAlquiler`: la definición no se mezcla con el historial de instancias en el tiempo.

### Gasto (asociado a una propiedad, a cargo del propietario)
- id
- propiedad_id
- categoría (reparación / mantenimiento / mejora / otro)
- monto
- fecha
- descripción (opcional, detalle libre dentro de la categoría)

> A diferencia del impuesto, el gasto es siempre a cargo del propietario, no tiene ninguna relación con el inquilino. Impacta directamente en el cálculo de rentabilidad neta.

### Pago / Movimiento (histórico mensual — libro mayor único de alquiler e impuestos)
- id
- propiedad_id
- tipo (alquiler / impuesto)
- impuesto_id (FK a Impuesto, null si tipo = alquiler)
- período (mes/año que corresponde)
- monto correspondiente (lo que debía pagarse ese mes)
- fecha de vencimiento
- monto pagado
- fecha de pago (si se pagó — null significa pendiente)
- diferencia → si es negativa, pasa a deuda
- recargo aplicado (solo si tipo = alquiler y hay atraso)
- método de pago (efectivo / transferencia) — solo aplica a pagos del inquilino (alquiler e impuestos), no a los gastos del propietario

---

## 5. Reglas de negocio definidas

### 5.1 Aumento por IPC
- Se usa el **IPC específico de "Alquiler de vivienda"** (INDEC lo desagrega por rubro), no el IPC general.
- Fórmula: `nuevo_monto = monto_anterior * (1 + IPC_acumulado_periodo / 100)`
- El sistema recalcula automáticamente el monto vigente cuando se cumple la fecha de ajuste (según la frecuencia configurada), sin que el usuario lo tenga que actualizar a mano.
- **Abierto:** si el índice del mes exacto todavía no fue publicado por INDEC (suele publicarse ~15 días después de cerrado el mes), ¿qué hace el sistema? Sugerencia: mostrar el último valor disponible con una advertencia de "provisorio, sujeto a actualización".

### 5.2 Deuda de alquiler
- Si el inquilino paga menos del monto correspondiente (o no paga), la diferencia se acumula como deuda para el mes siguiente.
- El recargo por mora es **interés simple**: se aplica solo sobre la deuda adeudada, no sobre recargos previos (no es interés compuesto).
- La **tasa de mora** queda como parámetro configurable (no hardcodeado), sin un valor por defecto definido todavía — hay que decidir el número antes de poder calcular montos reales.
- Si el inquilino hace un **pago parcial**, se imputa primero a la **deuda vieja** y lo que sobra al mes corriente.

### 5.3 Impuestos
- `Impuesto` es solo el catálogo (qué impuestos tiene la propiedad y su periodicidad). El monto real, la fecha de vencimiento y el estado pagado/pendiente viven en `Pago`, porque el monto varía mes a mes.
- No generan recargo por mora.
- El estado "pendiente" se deriva de que `fecha_pago` esté vacía en el `Pago` correspondiente — no es una columna aparte a mantener sincronizada.
- No hay una API pública para obtener estos montos automáticamente (ver sección 6.2) — la carga es manual: el inquilino informa el monto y el propietario lo paga.

### 5.4 Gastos
- Se registran por propiedad, con categoría fija (reparación / mantenimiento / mejora / otro), monto y fecha.
- Son siempre a cargo del propietario, sin vínculo con el inquilino ni con la deuda de alquiler.
- Impactan en el cálculo de **rentabilidad neta** de la propiedad: `rentabilidad_neta = alquiler_cobrado - impuestos - gastos`.

### 5.5 Propiedad
- Debe mostrar de un vistazo: nombre del inquilino, contacto, dirección, y si tiene deuda pendiente (sí/no + monto).
- Al cambiar de inquilino, se guarda el dato del inquilino anterior (no se acumula un historial completo).

### 5.6 Avisos
- No hay notificaciones activas (ni email ni push). Alcanza con **indicadores visuales en el dashboard** para vencimientos de impuestos, próximos aumentos por IPC y próximos vencimientos de contrato.

### 5.7 Edición de pagos
- El propietario puede editar o eliminar un pago (de alquiler o impuesto) cargado por error. Al editar/eliminar, el sistema debe recalcular la deuda acumulada de la propiedad en base al nuevo estado.

### 5.8 Exportación
- Se puede exportar el detalle de pagos, deuda y/o rentabilidad neta a Excel/CSV, para uso fuera del sistema (ej. compartir con un contador).

---

## 6. Fuentes de datos externas

### 6.1 IPC
Para automatizar la obtención del IPC sin scrapear INDEC directamente, hay APIs públicas y gratuitas ya armadas con esos datos:

- **ArgentinaDatos API** — `https://argentinadatos.com/` (documentación en `/docs`), gratuita, sin autenticación, con series históricas de inflación/IPC tomadas de INDEC.
- **Argly** — `https://api.argly.com.ar/v1/ipc`, también gratuita y sin autenticación, incluye IPC, ICL, UVA/UVI, CER, entre otros índices útiles para este tipo de sistema.
- **datos.gob.ar (Series de Tiempo AR)** — fuente oficial del Estado, algo más burocrática de integrar pero es la fuente primaria.

Sugerencia: usar una de las dos APIs no oficiales como fuente principal (más simples de integrar) y dejar la fuente oficial como respaldo/verificación. Hay que confirmar cuál de las dos trae el desagregado específico de "Alquiler de vivienda" y no solo el IPC general.

### 6.2 Impuestos y facturas (Córdoba)
No existe una API pública para obtener automáticamente el monto de facturas o impuestos de las propiedades:

- **Impuesto Inmobiliario (Rentas Córdoba)**: solo tiene portal web con login por CUIT, sin API para desarrolladores.
- **EPEC (factura de luz)**: solo "Oficina Virtual" y app móvil con login y número de contrato, tampoco expone API pública.
- Es esperable que agua (ERSeP/Aguas Cordobesas) y tasas municipales tengan la misma limitación.

Automatizarlo requeriría scraping con las credenciales del propietario, lo cual es frágil (rompe si el sitio cambia), puede violar términos de uso, y obliga a guardar credenciales sensibles de organismos públicos. **Decisión: la carga de impuestos y facturas queda manual**, en línea con el flujo ya definido (el inquilino informa el monto, el propietario lo carga).

---

## 7. MVP sugerido (primera versión)

1. Login de usuario.
2. ABM de propiedades (con inquilino, contacto, dirección, monto inicial, fecha de inicio y fin de contrato, frecuencia de ajuste, contrato en PDF).
3. ABM de impuestos por propiedad (carga manual).
4. ABM de gastos por propiedad, con categoría (reparación / mantenimiento / mejora / otro).
5. Carga manual de pagos mensuales (alquiler e impuestos), con método de pago (efectivo / transferencia), editables/eliminables por el propietario.
6. Cálculo automático del monto vigente del alquiler según IPC de alquiler de vivienda.
7. Cálculo y visualización de deuda acumulada con recargo simple, recalculada si se edita/elimina un pago.
8. Cálculo de rentabilidad neta por propiedad (alquiler - impuestos - gastos).
9. Dashboard con indicadores visuales: deuda pendiente por propiedad, impuestos por vencer, próximos aumentos por IPC, contratos por vencer, rentabilidad neta.
10. Exportación de pagos/deuda/rentabilidad neta a Excel/CSV.

### Para una v2 (fuera de alcance por ahora)
- Notificaciones por email/push.
- Login propio para el inquilino (ver su estado de cuenta).
- Reportes históricos (ingresos totales, deuda total, proyección).
- Soporte multi-propietario / condominios.

---

## 8. Preguntas que quedan abiertas

1. ¿Qué hace el sistema si el IPC del mes exacto todavía no fue publicado por INDEC? (¿mostrar el último valor disponible como "provisorio"?)
2. ¿Cuál de las APIs de IPC (ArgentinaDatos o Argly) tiene el desagregado de "Alquiler de vivienda" y no solo el índice general? Hay que confirmarlo antes de integrar.
3. ¿Cuál es el valor de la tasa de mora? Queda modelada como parámetro configurable, pero todavía no tiene un número definido.