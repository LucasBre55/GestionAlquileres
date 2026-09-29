import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { usuarios } from '../src/db/schema';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const ETX = '\u0003'; // Ctrl+C
const EOT = '\u0004'; // Ctrl+D
const BACKSPACE = '\u0008';
const DELETE = '\u007f';

/**
 * Lo que llegó por stdin después del salto de línea de la lectura anterior.
 * stdin entrega chunks, no líneas: sin este buffer, todo lo que viniera pegado
 * detrás del primer `\n` se perdería y la siguiente pregunta quedaría colgada.
 */
let pendiente = '';
let rawActivo = false;

/**
 * Lee una línea de stdin controlando el eco a mano. En modo raw la terminal no
 * imprime nada por su cuenta: las respuestas visibles se reimprimen acá y la
 * contraseña simplemente no se imprime, así no queda en pantalla ni en el
 * scrollback, igual que hace `sudo`.
 */
function leerLinea(texto: string, { oculto = false } = {}): Promise<string> {
  const { stdin, stdout } = process;
  const echo = Boolean(stdin.isTTY) && !oculto;

  stdout.write(texto);

  return new Promise<string>((resolve, reject) => {
    let valor = '';
    let cancelado = false;

    const terminar = () => {
      if (rawActivo) {
        stdin.setRawMode(false);
        rawActivo = false;
      }
      stdin.pause();
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      stdout.write('\n');
    };

    /** Devuelve true cuando la línea quedó completa (o se canceló). */
    const consumir = (entrada: string): boolean => {
      for (let i = 0; i < entrada.length; i += 1) {
        const caracter = entrada[i];

        if (caracter === '\n' || caracter === '\r' || caracter === EOT) {
          pendiente = entrada.slice(i + 1);
          if (caracter === '\r' && pendiente.startsWith('\n')) {
            pendiente = pendiente.slice(1);
          }
          return true;
        }

        if (caracter === ETX) {
          pendiente = '';
          cancelado = true;
          return true;
        }

        if (caracter === BACKSPACE || caracter === DELETE) {
          if (valor.length > 0) {
            valor = valor.slice(0, -1);
            if (echo) stdout.write('\b \b');
          }
          continue;
        }

        // Descarta caracteres de control y secuencias de escape (flechas, etc.).
        if (caracter < ' ') continue;

        valor += caracter;
        if (echo) stdout.write(caracter);
      }

      pendiente = '';
      return false;
    };

    const resolverSegunEstado = () => {
      terminar();
      if (cancelado) {
        reject(new Error('Operación cancelada.'));
      } else {
        resolve(valor);
      }
    };

    const onData = (chunk: string) => {
      if (consumir(chunk)) resolverSegunEstado();
    };

    const onEnd = () => {
      terminar();
      resolve(valor);
    };

    const onError = (error: Error) => {
      terminar();
      reject(error);
    };

    // Primero se drena lo que ya había llegado en un chunk anterior.
    const arrastre = pendiente;
    pendiente = '';
    if (consumir(arrastre)) {
      resolverSegunEstado();
      return;
    }

    stdin.setEncoding('utf8');
    if (stdin.isTTY) {
      stdin.setRawMode(true);
      rawActivo = true;
    }
    stdin.resume();
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
  });
}

const preguntar = (texto: string) => leerLinea(texto);
const preguntarOculto = (texto: string) => leerLinea(texto, { oculto: true });

function esEmailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile?.();
    } catch {
      // Sin archivo .env local: la variable puede venir del entorno del sistema.
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'La variable de entorno DATABASE_URL no está definida. Configurala en .env.local (o .env) y volvé a ejecutar el script.'
    );
  }

  // Import diferido: src/db/index.ts abre la conexión al evaluarse, así que se
  // carga recién cuando ya sabemos que hay DATABASE_URL.
  const { db } = await import('../src/db/index');

  const email = (await preguntar('Email del propietario: ')).trim().toLowerCase();

  if (!esEmailValido(email)) {
    throw new Error(`El email ingresado no es válido: "${email}"`);
  }

  const [usuarioExistente] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, email));

  // El nombre es obligatorio en el schema, pero solo hace falta al crear:
  // en un reseteo de contraseña no se toca el resto del registro.
  let nombre = '';
  if (!usuarioExistente) {
    nombre = (await preguntar('Nombre del propietario: ')).trim();
    if (!nombre) {
      throw new Error('El nombre no puede estar vacío.');
    }
  }

  const password = await preguntarOculto(
    `Contraseña (no se muestra al tipear, mínimo ${MIN_PASSWORD_LENGTH} caracteres): `
  );

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const confirmacion = await preguntarOculto('Repetir contraseña: ');

  if (password !== confirmacion) {
    throw new Error('Las contraseñas no coinciden.');
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  if (usuarioExistente) {
    await db
      .update(usuarios)
      .set({ passwordHash })
      .where(eq(usuarios.id, usuarioExistente.id));

    console.log(`✔ Contraseña actualizada para el usuario existente: ${email}`);
  } else {
    await db.insert(usuarios).values({ nombre, email, passwordHash });

    console.log(`✔ Usuario creado: ${email}`);
  }
}

main().catch((error: unknown) => {
  console.error(
    `✖ ${error instanceof Error ? error.message : 'Error inesperado al crear el usuario.'}`
  );
  process.exitCode = 1;
});
