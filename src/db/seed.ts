import { eq } from 'drizzle-orm';
import { db } from './index';
import { gastos, pagos, propiedades, usuarios } from './schema';

async function seed() {
  console.log('🌱 Iniciando la carga de datos de prueba (seed)...');

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'La variable de entorno DATABASE_URL no está definida. Configúrala en el archivo .env'
      );
    }

    const testEmail = 'carlos.propietario@ejemplo.com';

    // 1. Limpieza preventiva para garantizar idempotencia en ejecuciones repetidas
    const [existingUser] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, testEmail));

    if (existingUser) {
      console.log(`🧹 Limpiando registros previos del usuario de prueba (${testEmail})...`);
      // Al borrar propiedades, los gastos y pagos asociados se eliminan en cascada (onDelete: 'cascade')
      await db
        .delete(propiedades)
        .where(eq(propiedades.propietarioId, existingUser.id));
      await db.delete(usuarios).where(eq(usuarios.id, existingUser.id));
    }

    // 2. Insertar 1 usuario ficticio (propietario)
    console.log('👤 Insertando usuario ficticio (propietario)...');
    const [usuario] = await db
      .insert(usuarios)
      .values({
        nombre: 'Carlos Gómez (Propietario)',
        email: testEmail,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr', // Hash simulado de contraseña
      })
      .returning();

    console.log(`   ✔ Usuario creado con ID: ${usuario.id} (${usuario.email})`);

    // 3. Insertar 1 propiedad ficticia asociada al usuario
    console.log('🏠 Insertando propiedad ficticia...');
    const [propiedad] = await db
      .insert(propiedades)
      .values({
        propietarioId: usuario.id,
        direccion: 'Av. Colón 1234, Barrio Alberdi, Córdoba',
        inquilinoActual: 'Juan Pérez',
        contactoInquilino: '+54 9 351 123-4567',
        inquilinoAnterior: 'María Fernández',
        montoInicial: '250000.00',
        montoActual: '250000.00',
        fechaInicioContrato: '2026-01-01',
        fechaFinContrato: '2027-12-31',
        frecuenciaAumento: 4, // aumento cada 4 meses
        deudaAcumulada: '0.00',
        estado: 'activa',
      })
      .returning();

    console.log(`   ✔ Propiedad creada con ID: ${propiedad.id} (${propiedad.direccion})`);

    // 4. Insertar 1 gasto para esa propiedad
    console.log('🔧 Insertando gasto para la propiedad...');
    const [gasto] = await db
      .insert(gastos)
      .values({
        propiedadId: propiedad.id,
        categoria: 'reparacion',
        monto: '18500.00',
        fecha: '2026-02-15',
        descripcion: 'Reparación de cañería en cocina',
      })
      .returning();

    console.log(`   ✔ Gasto registrado con ID: ${gasto.id} ($${gasto.monto} - ${gasto.categoria})`);

    // 5. Insertar 1 pago para esa propiedad
    console.log('💳 Insertando pago para la propiedad...');
    const [pago] = await db
      .insert(pagos)
      .values({
        propiedadId: propiedad.id,
        tipo: 'alquiler',
        periodo: '2026-02-01',
        montoCorrespondiente: '250000.00',
        fechaVencimiento: '2026-02-10',
        montoPagado: '250000.00',
        fechaPago: '2026-02-08',
        recargoAplicado: '0.00',
        metodoPago: 'transferencia',
      })
      .returning();

    console.log(`   ✔ Pago registrado con ID: ${pago.id} ($${pago.montoPagado} - ${pago.tipo})`);

    console.log('\n🎉 ¡Seed de datos de prueba completado exitosamente!');
  } catch (error) {
    console.error('❌ Error al ejecutar el seed de datos:', error);
    process.exit(1);
  }
}

seed();

