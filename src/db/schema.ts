import { relations } from 'drizzle-orm';
import {
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
} from 'drizzle-orm/pg-core';

export const estadoPropiedadEnum = pgEnum('estado_propiedad', ['activa', 'inactiva']);
export const categoriaGastoEnum = pgEnum('categoria_gasto', [
  'reparacion',
  'mantenimiento',
  'mejora',
  'otro',
]);
export const tipoPagoEnum = pgEnum('tipo_pago', ['alquiler', 'impuesto']);
export const metodoPagoEnum = pgEnum('metodo_pago', ['efectivo', 'transferencia']);

export const usuarios = pgTable('usuarios', {
  id: serial('id').primaryKey(),
  nombre: text('nombre').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});

export const propiedades = pgTable('propiedades', {
  id: serial('id').primaryKey(),
  propietarioId: integer('propietario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'restrict' }),
  inquilinoActual: text('inquilino_actual'),
  contactoInquilino: text('contacto_inquilino'),
  inquilinoAnterior: text('inquilino_anterior'),
  direccion: text('direccion').notNull(),
  montoInicial: numeric('monto_inicial', { precision: 12, scale: 2 }).notNull(),
  fechaInicioContrato: date('fecha_inicio_contrato').notNull(),
  fechaFinContrato: date('fecha_fin_contrato').notNull(),
  frecuenciaAumento: integer('frecuencia_aumento').notNull(),
  montoActual: numeric('monto_actual', { precision: 12, scale: 2 }).notNull(),
  deudaAcumulada: numeric('deuda_acumulada', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  estado: estadoPropiedadEnum('estado').notNull().default('activa'),
  contratoPdfUrl: text('contrato_pdf_url'),
});

export const ajustesAlquiler = pgTable('ajustes_alquiler', {
  id: serial('id').primaryKey(),
  propiedadId: integer('propiedad_id')
    .notNull()
    .references(() => propiedades.id, { onDelete: 'cascade' }),
  monto: numeric('monto', { precision: 12, scale: 2 }).notNull(),
  vigenteDesde: date('vigente_desde').notNull(),
});

export const impuestos = pgTable('impuestos', {
  id: serial('id').primaryKey(),
  propiedadId: integer('propiedad_id')
    .notNull()
    .references(() => propiedades.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(),
  periodicidad: text('periodicidad').notNull(),
});

export const gastos = pgTable('gastos', {
  id: serial('id').primaryKey(),
  propiedadId: integer('propiedad_id')
    .notNull()
    .references(() => propiedades.id, { onDelete: 'cascade' }),
  categoria: categoriaGastoEnum('categoria').notNull(),
  monto: numeric('monto', { precision: 12, scale: 2 }).notNull(),
  fecha: date('fecha').notNull(),
  descripcion: text('descripcion'),
});

export const pagos = pgTable('pagos', {
  id: serial('id').primaryKey(),
  propiedadId: integer('propiedad_id')
    .notNull()
    .references(() => propiedades.id, { onDelete: 'cascade' }),
  tipo: tipoPagoEnum('tipo').notNull(),
  impuestoId: integer('impuesto_id').references(() => impuestos.id, {
    onDelete: 'restrict',
  }),
  periodo: date('periodo').notNull(),
  montoCorrespondiente: numeric('monto_correspondiente', {
    precision: 12,
    scale: 2,
  }).notNull(),
  fechaVencimiento: date('fecha_vencimiento').notNull(),
  montoPagado: numeric('monto_pagado', { precision: 12, scale: 2 }),
  fechaPago: date('fecha_pago'),
  recargoAplicado: numeric('recargo_aplicado', { precision: 12, scale: 2 }),
  metodoPago: metodoPagoEnum('metodo_pago'),
});

export const usuariosRelations = relations(usuarios, ({ many }) => ({
  propiedades: many(propiedades),
}));

export const propiedadesRelations = relations(propiedades, ({ one, many }) => ({
  propietario: one(usuarios, {
    fields: [propiedades.propietarioId],
    references: [usuarios.id],
  }),
  ajustesAlquiler: many(ajustesAlquiler),
  impuestos: many(impuestos),
  gastos: many(gastos),
  pagos: many(pagos),
}));

export const ajustesAlquilerRelations = relations(ajustesAlquiler, ({ one }) => ({
  propiedad: one(propiedades, {
    fields: [ajustesAlquiler.propiedadId],
    references: [propiedades.id],
  }),
}));

export const impuestosRelations = relations(impuestos, ({ one, many }) => ({
  propiedad: one(propiedades, {
    fields: [impuestos.propiedadId],
    references: [propiedades.id],
  }),
  pagos: many(pagos),
}));

export const gastosRelations = relations(gastos, ({ one }) => ({
  propiedad: one(propiedades, {
    fields: [gastos.propiedadId],
    references: [propiedades.id],
  }),
}));

export const pagosRelations = relations(pagos, ({ one }) => ({
  propiedad: one(propiedades, {
    fields: [pagos.propiedadId],
    references: [propiedades.id],
  }),
  impuesto: one(impuestos, {
    fields: [pagos.impuestoId],
    references: [impuestos.id],
  }),
}));
