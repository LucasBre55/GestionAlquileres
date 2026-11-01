import { z } from 'zod'

// Sin imports de servidor (db, session, next/headers): el formulario de la UI importa
// este esquema para validar en el cliente. La validación autoritativa es la de la
// server action, que vuelve a correrlo.

const MAX_DIRECCION = 200
const MAX_TEXTO_OPCIONAL = 120
const MAX_FRECUENCIA_MESES = 120
// numeric(12,2): 10 dígitos enteros + 2 decimales
const MAX_DIGITOS_ENTEROS = 10

const MONTO_REGEX = /^\d+(\.\d{1,2})?$/

// Sin aritmética ni parseFloat: el monto viaja siempre como string.
function normalizarMonto(valor: string): string {
  const [entero, decimales = ''] = valor.split('.')
  return `${entero.replace(/^0+(?=\d)/, '')}.${decimales.padEnd(2, '0')}`
}

const monto = z
  .string({ error: 'El monto es obligatorio' })
  .trim()
  .regex(MONTO_REGEX, {
    error: 'Ingresá un monto válido: solo números y hasta 2 decimales, con punto',
  })
  .pipe(
    z
      .string()
      .refine((valor) => /[1-9]/.test(valor), { error: 'El monto debe ser mayor a 0' })
      .refine(
        (valor) => normalizarMonto(valor).split('.')[0].length <= MAX_DIGITOS_ENTEROS,
        { error: 'El monto es demasiado grande' }
      )
      .transform(normalizarMonto)
  )

const fecha = (campo: string) =>
  z.iso.date({ error: `${campo} debe ser una fecha válida` })

const textoObligatorio = (campo: string, max: number) =>
  z
    .string({ error: `${campo} es obligatoria` })
    .trim()
    .min(1, { error: `${campo} es obligatoria` })
    .max(max, { error: `${campo} no puede superar los ${max} caracteres` })

const textoOpcional = (campo: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `${campo} no puede superar los ${max} caracteres` })
    .transform((valor) => (valor === '' ? null : valor))
    .nullish()
    .transform((valor) => valor ?? null)

const frecuenciaAumento = z
  .string({ error: 'La frecuencia de aumento es obligatoria' })
  .trim()
  .regex(/^\d+$/, { error: 'La frecuencia de aumento debe ser un número entero de meses' })
  .transform(Number)
  .pipe(
    z
      .number()
      .min(1, { error: 'La frecuencia de aumento debe ser de al menos 1 mes' })
      .max(MAX_FRECUENCIA_MESES, {
        error: `La frecuencia de aumento no puede superar los ${MAX_FRECUENCIA_MESES} meses`,
      })
  )

export const CAMPOS_PROPIEDAD = [
  'inquilinoActual',
  'contactoInquilino',
  'direccion',
  'montoInicial',
  'fechaInicioContrato',
  'fechaFinContrato',
  'frecuenciaAumento',
] as const

// Objeto base sin refinamientos: zod 4 no permite `.omit()` sobre un objeto refinado,
// así que el esquema de edición se deriva de acá y no de `crearPropiedadSchema`.
const propiedadBaseSchema = z.object({
  inquilinoActual: textoOpcional('El nombre del inquilino', MAX_TEXTO_OPCIONAL),
  contactoInquilino: textoOpcional('El contacto del inquilino', MAX_TEXTO_OPCIONAL),
  direccion: textoObligatorio('La dirección', MAX_DIRECCION),
  montoInicial: monto,
  fechaInicioContrato: fecha('La fecha de inicio del contrato'),
  fechaFinContrato: fecha('La fecha de fin del contrato'),
  frecuenciaAumento,
})

// Las fechas ISO (YYYY-MM-DD) se ordenan igual como string que como fecha, sin pasar
// por Date (que correría el día según la zona horaria).
export const MENSAJE_FIN_POSTERIOR_A_INICIO = 'La fecha de fin debe ser posterior a la fecha de inicio'

export const crearPropiedadSchema = propiedadBaseSchema.refine(
  (datos) => datos.fechaFinContrato > datos.fechaInicioContrato,
  { path: ['fechaFinContrato'], error: MENSAJE_FIN_POSTERIOR_A_INICIO }
)

// Whitelist de la edición: monto inicial y fecha de inicio quedan fijos (son el punto de
// partida del historial de ajustes), y estado/contrato tienen sus propias acciones.
export const CAMPOS_EDITAR_PROPIEDAD = [
  'inquilinoActual',
  'contactoInquilino',
  'direccion',
  'fechaFinContrato',
  'frecuenciaAumento',
] as const

// Sin el refinamiento fin > inicio: la fecha de inicio no está en el formulario de
// edición, la compara la capa de lógica contra el valor guardado.
export const editarPropiedadSchema = propiedadBaseSchema.omit({
  montoInicial: true,
  fechaInicioContrato: true,
})

export const propiedadIdSchema = z
  .string({ error: 'La propiedad es obligatoria' })
  .trim()
  .regex(/^\d+$/, { error: 'La propiedad no es válida' })
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .positive({ error: 'La propiedad no es válida' })
      // serial = int4: un id mayor ni siquiera puede existir
      .max(2_147_483_647, { error: 'La propiedad no es válida' })
  )

export type PropiedadInput = z.output<typeof crearPropiedadSchema>
export type PropiedadErrors = Partial<Record<(typeof CAMPOS_PROPIEDAD)[number], string[]>>
export type EditarPropiedadInput = z.output<typeof editarPropiedadSchema>
export type EditarPropiedadErrors = Partial<
  Record<(typeof CAMPOS_EDITAR_PROPIEDAD)[number] | 'propiedadId', string[]>
>
