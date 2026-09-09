import { del, issueSignedToken, presignUrl, put } from '@vercel/blob';

/**
 * Sube el archivo de contrato PDF de una propiedad a Vercel Blob (modo privado).
 *
 * @param propiedadId - ID numérico de la propiedad asociada
 * @param file - Archivo PDF a subir
 * @returns El pathname del blob en el store (ej. `contratos/1.pdf`), NO una URL pública.
 */
export async function subirContratoPDF(
  propiedadId: number,
  file: File
): Promise<string> {
  const pathname = `contratos/${propiedadId}.pdf`;

  const blob = await put(pathname, file, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.pathname;
}

/**
 * Genera una URL firmada temporal (5 minutos de validez) para acceder a un contrato privado
 * sin exponer credenciales ni dar acceso permanente al store.
 *
 * @param pathname - El pathname del contrato en el store (ej. `contratos/1.pdf`)
 * @returns URL temporal prefirmada para visualizar o descargar el archivo
 */
export async function obtenerUrlContrato(pathname: string): Promise<string> {
  const CINCO_MINUTOS_MS = 5 * 60 * 1000;
  const validUntil = Date.now() + CINCO_MINUTOS_MS;

  const signedToken = await issueSignedToken({
    pathname,
    operations: ['get'],
    validUntil,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil,
  });

  return presignedUrl;
}

/**
 * Elimina el blob del contrato especificado en Vercel Blob.
 * Útil para limpiar el contrato viejo cuando se reemplaza por uno nuevo.
 *
 * @param pathname - El pathname del blob a eliminar
 */
export async function eliminarContratoPDF(pathname: string): Promise<void> {
  await del(pathname);
}

