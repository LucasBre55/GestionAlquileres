// TEMPORAL: verificación manual de #49 contra Neon y Vercel Blob reales. NO se commitea.
// Sin reintentos: cada operación corre una sola vez y el fallo se muestra crudo.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/tmp-verify-49.mts
import { inspect } from 'node:util'
import { BlobNotFoundError, del, get, put } from '@vercel/blob'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { ajustesAlquiler, gastos, impuestos, pagos, propiedades, usuarios } from '@/db/schema'
import { withTransaction } from '@/db/transaction'
import { eliminarContratoPDF } from '@/lib/blob'
import { cambiarEstadoPropiedad } from '@/lib/cambiar-estado-propiedad'
import { crearPropiedad } from '@/lib/crear-propiedad'
import { eliminarPropiedad } from '@/lib/eliminar-propiedad'

// Guardas: nada se escribe si el entorno no es el esperado
const host = new URL(process.env.DATABASE_URL!).hostname
if (!host.includes('neon.tech')) throw new Error('DATABASE_URL no es un host de Neon, abortando')
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN, abortando')

// Todo lo que este script crea y borra se identifica SOLO por estos emails y pathnames.
const stamp = Date.now()
const EMAIL_DUENO = `tmp-verify-49-${stamp}-dueno@example.com`
const EMAIL_OTRO = `tmp-verify-49-${stamp}-otro@example.com`
const EMAILS = [EMAIL_DUENO, EMAIL_OTRO]
// Prefijo propio, a propósito distinto de contratos/<id>.pdf (el formato de una propiedad real)
const pathname = (nombre: string) => `contratos/tmp-verify-49-${stamp}-${nombre}.pdf`
const PATH_IDEMPOTENCIA = pathname('idempotencia')
const PATH_CON_CONTRATO = pathname('con-contrato')
const PATH_INEXISTENTE = pathname('nunca-subido')
const PATHNAMES = [PATH_IDEMPOTENCIA, PATH_CON_CONTRATO, PATH_INEXISTENTE]

const HTTP = 'neon-http (db)'
const WS = 'WebSocket (withTransaction -> Pool de neon-serverless)'
const BLOB = 'Vercel Blob (SDK @vercel/blob)'

// PDF mínimo válido, suficiente para subirlo
const PDF_MINIMO = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
)

let fallos = 0
const MAX_NIVELES_CAUSA = 10
const CAMPOS_RED = ['address', 'port', 'syscall'] as const

function pareceError(e: unknown): e is object {
  return typeof e === 'object' && e !== null && ('message' in e || 'error' in e)
}

// Recorre cause, AggregateError.errors y el .error de un ErrorEvent, un error por línea
function describirError(e: unknown, nivel = 0, rotulo = 'error'): string {
  const sangria = '  '.repeat(nivel + 1)
  if (!(e instanceof Error) && !pareceError(e)) {
    return `${sangria}[${nivel}] ${rotulo} (valor sin message ni error): ${inspect(e, { depth: 1 })}`
  }
  const obj = e as Record<string, unknown>
  const nombre =
    e instanceof Error ? e.constructor.name : ((e as { constructor?: { name?: string } }).constructor?.name ?? 'Object')
  const mostrar = (v: unknown) => (v === undefined ? '-' : String(v))
  const campos = [
    `class=${nombre}`,
    `message=${mostrar(obj.message)}`,
    `code=${mostrar(obj.code)}`,
    ...CAMPOS_RED.flatMap((campo) => (obj[campo] === undefined ? [] : [`${campo}=${String(obj[campo])}`])),
  ]
  const linea = `${sangria}[${nivel}] ${rotulo}: ${campos.join(' | ')}`
  const hijos: Array<{ valor: unknown; rotulo: string }> = []
  if (e instanceof AggregateError) {
    e.errors.forEach((interno, i) => hijos.push({ valor: interno, rotulo: `errors[${i}]/${e.errors.length}` }))
  }
  if (obj.cause !== undefined) hijos.push({ valor: obj.cause, rotulo: 'causa' })
  if (!(e instanceof Error) && obj.error !== undefined) hijos.push({ valor: obj.error, rotulo: 'error' })
  if (hijos.length === 0) return linea
  if (nivel + 1 >= MAX_NIVELES_CAUSA) {
    return `${linea}\n${sangria}  ... cadena truncada en ${MAX_NIVELES_CAUSA} niveles`
  }
  return [linea, ...hijos.map((h) => describirError(h.valor, nivel + 1, h.rotulo))].join('\n')
}

function chequear(paso: string, etiqueta: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(
    `${ok ? 'OK   ' : 'FALLO'} [${paso}] ${etiqueta}: obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`
  )
}

function info(paso: string, mensaje: string) {
  console.log(`INFO  [${paso}] ${mensaje}`)
}

async function paso<T>(
  nombre: string,
  cliente: string,
  fn: () => Promise<T>
): Promise<{ ok: true; valor: T } | { ok: false }> {
  console.log(`\n>>> [${nombre}] cliente: ${cliente}`)
  try {
    return { ok: true, valor: await fn() }
  } catch (e) {
    fallos++
    console.error(`FALLO [${nombre}] (cliente: ${cliente}) lanzó:\n${describirError(e)}`)
    return { ok: false }
  }
}

function omitido(nombre: string, motivo: string) {
  fallos++
  console.log(`\n>>> [${nombre}] OMITIDO: ${motivo}`)
}

// Existencia en un store PRIVADO: get() con access 'private' devuelve null si no existe.
// useCache:false lee del origen, así no se ve una copia cacheada de un archivo ya borrado.
async function existeEnBlob(path: string): Promise<boolean> {
  const r = await get(path, { access: 'private', useCache: false })
  if (r === null) return false
  await r.stream?.cancel().catch(() => {})
  return true
}

async function subir(path: string) {
  await put(path, PDF_MINIMO, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/pdf',
  })
}

async function leerFila(id: number) {
  const [fila] = await db.select().from(propiedades).where(eq(propiedades.id, id))
  return fila
}

async function contarHijos(id: number) {
  const cuenta = async (tabla: typeof ajustesAlquiler | typeof impuestos | typeof gastos | typeof pagos) =>
    (await db.select({ id: tabla.id }).from(tabla).where(eq(tabla.propiedadId, id))).length
  return {
    ajustes_alquiler: await cuenta(ajustesAlquiler),
    impuestos: await cuenta(impuestos),
    gastos: await cuenta(gastos),
    pagos: await cuenta(pagos),
  }
}

const datosPropiedad = (direccion: string) => ({
  inquilinoActual: 'TMP A',
  contactoInquilino: null,
  direccion,
  montoInicial: '1000.00',
  fechaInicioContrato: '2026-01-01',
  fechaFinContrato: '2027-01-01',
  frecuenciaAumento: 3,
})

// Los dueños de las filas de este script, siempre por email (nunca por id suelto)
const usuariosDeEsteScript = () =>
  db.select({ id: usuarios.id }).from(usuarios).where(inArray(usuarios.email, EMAILS))

try {
  // 1. Idempotencia del borrado en Blob (dato informativo)
  await paso('blob: idempotencia', BLOB, async () => {
    await subir(PATH_IDEMPOTENCIA)
    chequear('blob: idempotencia', 'existe tras subirlo', await existeEnBlob(PATH_IDEMPOTENCIA), true)

    await eliminarContratoPDF(PATH_IDEMPOTENCIA)
    chequear('blob: idempotencia', '1ª llamada: el archivo ya no existe', await existeEnBlob(PATH_IDEMPOTENCIA), false)

    try {
      await eliminarContratoPDF(PATH_IDEMPOTENCIA)
      info('blob: idempotencia', '2ª llamada sobre un archivo ya borrado: ÉXITO SILENCIOSO (no lanzó)')
    } catch (e) {
      if (e instanceof BlobNotFoundError) {
        info('blob: idempotencia', '2ª llamada sobre un archivo ya borrado: lanzó BlobNotFoundError (eliminarPropiedad lo tolera)')
      } else {
        fallos++
        console.error(`FALLO [blob: idempotencia] la 2ª llamada lanzó algo que NO es BlobNotFoundError:\n${describirError(e)}`)
      }
    }
  })

  // 2. Datos: dos usuarios y una propiedad completa con contrato
  let dueno: { id: number } | undefined
  let otro: { id: number } | undefined
  let propiedadId: number | undefined

  const usuariosCreados = await paso('crear datos: usuarios', HTTP, () =>
    db
      .insert(usuarios)
      .values([
        { nombre: 'TMP verify 49 dueño', email: EMAIL_DUENO, passwordHash: 'x' },
        { nombre: 'TMP verify 49 otro', email: EMAIL_OTRO, passwordHash: 'x' },
      ])
      .returning({ id: usuarios.id })
  )
  if (usuariosCreados.ok) [dueno, otro] = usuariosCreados.valor

  if (!dueno) {
    omitido('crear datos: propiedad', 'no se pudieron crear los usuarios')
  } else {
    const duenoId = dueno.id
    // crearPropiedad inserta la propiedad y su ajuste inicial: necesita transacción
    const creada = await paso('crear datos: propiedad + ajuste inicial', WS, () =>
      withTransaction((tx) => crearPropiedad(tx, duenoId, datosPropiedad('TMP verify 49 con contrato')))
    )
    if (creada.ok) {
      const id = creada.valor
      const hijos = await paso('crear datos: impuesto, pago, gasto y contrato', `${HTTP} + ${BLOB}`, async () => {
        const [impuesto] = await db
          .insert(impuestos)
          .values({ propiedadId: id, tipo: 'ABL', periodicidad: 'mensual' })
          .returning({ id: impuestos.id })
        // Un pago que referencia al impuesto: pagos.impuesto_id es ON DELETE RESTRICT
        await db.insert(pagos).values({
          propiedadId: id,
          tipo: 'impuesto',
          impuestoId: impuesto.id,
          periodo: '2026-02-01',
          montoCorrespondiente: '500.00',
          fechaVencimiento: '2026-02-10',
        })
        await db.insert(gastos).values({ propiedadId: id, categoria: 'otro', monto: '100.00', fecha: '2026-02-01' })
        await subir(PATH_CON_CONTRATO)
        await db.update(propiedades).set({ contratoPdfUrl: PATH_CON_CONTRATO }).where(eq(propiedades.id, id))
      })
      if (hijos.ok) {
        propiedadId = id
        chequear('crear datos', 'hijos de la propiedad', await contarHijos(id), {
          ajustes_alquiler: 1,
          impuestos: 1,
          gastos: 1,
          pagos: 1,
        })
      }
    }
  }

  // 3. Ownership con los servicios reales
  if (!otro || propiedadId === undefined) {
    omitido('ownership', 'faltan el segundo usuario o la propiedad')
  } else {
    const idP = propiedadId
    const otroId = otro.id
    await paso('ownership', `${HTTP} + ${BLOB}`, async () => {
      const antes = await leerFila(idP)
      const estado = await cambiarEstadoPropiedad(db, otroId, idP, 'inactiva')
      chequear('ownership', 'cambiarEstado por otro usuario | status', estado.status, 'no_encontrada')
      const eliminar = await eliminarPropiedad(db, otroId, idP)
      chequear('ownership', 'eliminar por otro usuario | status', eliminar.status, 'no_encontrada')
      chequear('ownership', 'la fila sigue idéntica', await leerFila(idP), antes)
      chequear('ownership', 'el archivo sigue existiendo en Blob', await existeEnBlob(PATH_CON_CONTRATO), true)
    })
  }

  // 4. Estado: activa -> inactiva -> activa con neon-http
  if (!dueno || propiedadId === undefined) {
    omitido('estado', 'no hay propiedad creada')
  } else {
    const idP = propiedadId
    const duenoId = dueno.id
    await paso('estado', `${HTTP}: cambiarEstadoPropiedad + select de lectura`, async () => {
      const antes = await leerFila(idP)
      chequear('estado', 'estado inicial', antes.estado, 'activa')

      const r1 = await cambiarEstadoPropiedad(db, duenoId, idP, 'inactiva')
      chequear('estado', 'activa -> inactiva | status', r1.status, 'ok')
      chequear('estado', 'activa -> inactiva | solo cambió estado', await leerFila(idP), { ...antes, estado: 'inactiva' })

      const r2 = await cambiarEstadoPropiedad(db, duenoId, idP, 'activa')
      chequear('estado', 'inactiva -> activa | status', r2.status, 'ok')
      chequear('estado', 'inactiva -> activa | fila idéntica a la inicial', await leerFila(idP), antes)
    })
  }

  // 5. Eliminar con contrato: el camino de producción (neon-http + Blob real)
  if (!dueno || propiedadId === undefined) {
    omitido('eliminar con contrato', 'no hay propiedad creada')
  } else {
    const idP = propiedadId
    const duenoId = dueno.id
    await paso('eliminar con contrato', `${HTTP} + ${BLOB}`, async () => {
      info('eliminar con contrato', 'existencia en Blob comprobada con get(pathname, { access: "private", useCache: false }): null = no existe')
      const r = await eliminarPropiedad(db, duenoId, idP)
      chequear('eliminar con contrato', 'status', r.status, 'ok')
      chequear('eliminar con contrato', 'la fila desapareció', await leerFila(idP), undefined)
      chequear('eliminar con contrato', 'hijos en cascada', await contarHijos(idP), {
        ajustes_alquiler: 0,
        impuestos: 0,
        gastos: 0,
        pagos: 0,
      })
      chequear('eliminar con contrato', 'el archivo ya no existe en Blob', await existeEnBlob(PATH_CON_CONTRATO), false)
    })
  }

  // 6. Eliminar con contrato_pdf_url apuntando a un archivo que no existe en Blob
  if (!dueno) {
    omitido('eliminar con contrato ya borrado', 'no hay usuario dueño')
  } else {
    const duenoId = dueno.id
    await paso('eliminar con contrato ya borrado', `${HTTP} + ${BLOB}`, async () => {
      chequear('eliminar con contrato ya borrado', 'precondición: el pathname no existe en Blob', await existeEnBlob(PATH_INEXISTENTE), false)
      const [fila] = await db
        .insert(propiedades)
        .values({
          propietarioId: duenoId,
          ...datosPropiedad('TMP verify 49 contrato ya borrado'),
          montoActual: '1000.00',
          contratoPdfUrl: PATH_INEXISTENTE,
        })
        .returning({ id: propiedades.id })
      const r = await eliminarPropiedad(db, duenoId, fila.id)
      chequear('eliminar con contrato ya borrado', 'status', r.status, 'ok')
      chequear('eliminar con contrato ya borrado', 'la fila desapareció', await leerFila(fila.id), undefined)
    })
  }

  // 7. Eliminar sin contrato
  if (!dueno) {
    omitido('eliminar sin contrato', 'no hay usuario dueño')
  } else {
    const duenoId = dueno.id
    await paso('eliminar sin contrato', HTTP, async () => {
      const [fila] = await db
        .insert(propiedades)
        .values({
          propietarioId: duenoId,
          ...datosPropiedad('TMP verify 49 sin contrato'),
          montoActual: '1000.00',
          contratoPdfUrl: null,
        })
        .returning({ id: propiedades.id })
      const r = await eliminarPropiedad(db, duenoId, fila.id)
      chequear('eliminar sin contrato', 'status', r.status, 'ok')
      chequear('eliminar sin contrato', 'la fila desapareció', await leerFila(fila.id), undefined)
    })
  }
} finally {
  // 8. Limpieza: SOLO por los emails y pathnames de este script. Corre siempre y cada
  // sub-paso se intenta aunque el anterior falle.
  await paso('limpieza: archivos', BLOB, async () => {
    for (const path of PATHNAMES) {
      try {
        await del(path)
      } catch (e) {
        if (!(e instanceof BlobNotFoundError)) throw e // not found = ya estaba borrado
      }
    }
  })
  const restantesBlob = await paso('limpieza: verificar archivos', BLOB, async () => {
    const existentes: string[] = []
    for (const path of PATHNAMES) if (await existeEnBlob(path)) existentes.push(path)
    return existentes
  })
  if (restantesBlob.ok) chequear('limpieza: verificar archivos', 'archivos restantes', restantesBlob.valor, [])

  await paso('limpieza: borrar propiedades', HTTP, () =>
    db.delete(propiedades).where(inArray(propiedades.propietarioId, usuariosDeEsteScript())) // hijos: cascade
  )
  const props = await paso('limpieza: verificar propiedades', HTTP, () =>
    db
      .select({ id: propiedades.id })
      .from(propiedades)
      .where(inArray(propiedades.propietarioId, usuariosDeEsteScript()))
  )
  if (props.ok) chequear('limpieza: verificar propiedades', 'propiedades restantes', props.valor.length, 0)

  await paso('limpieza: borrar usuarios', HTTP, () => db.delete(usuarios).where(inArray(usuarios.email, EMAILS)))
  const users = await paso('limpieza: verificar usuarios', HTTP, () =>
    db.select({ id: usuarios.id }).from(usuarios).where(inArray(usuarios.email, EMAILS))
  )
  if (users.ok) chequear('limpieza: verificar usuarios', 'usuarios restantes', users.valor.length, 0)

  if (fallos > 0) {
    console.log(`\nSi la limpieza falló, revisar a mano: emails tmp-verify-49-${stamp}-* y pathnames contratos/tmp-verify-49-${stamp}-*`)
  }
  console.log(fallos === 0 ? '\nRESULTADO: TODO OK' : `\nRESULTADO: ${fallos} FALLO(S)`)
  if (fallos > 0) process.exitCode = 1
}
