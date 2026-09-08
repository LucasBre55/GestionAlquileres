CREATE TYPE "public"."categoria_gasto" AS ENUM('reparacion', 'mantenimiento', 'mejora', 'otro');--> statement-breakpoint
CREATE TYPE "public"."estado_propiedad" AS ENUM('activa', 'inactiva');--> statement-breakpoint
CREATE TYPE "public"."metodo_pago" AS ENUM('efectivo', 'transferencia');--> statement-breakpoint
CREATE TYPE "public"."tipo_pago" AS ENUM('alquiler', 'impuesto');--> statement-breakpoint
CREATE TABLE "ajustes_alquiler" (
	"id" serial PRIMARY KEY NOT NULL,
	"propiedad_id" integer NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"vigente_desde" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gastos" (
	"id" serial PRIMARY KEY NOT NULL,
	"propiedad_id" integer NOT NULL,
	"categoria" "categoria_gasto" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"fecha" date NOT NULL,
	"descripcion" text
);
--> statement-breakpoint
CREATE TABLE "impuestos" (
	"id" serial PRIMARY KEY NOT NULL,
	"propiedad_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"periodicidad" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" serial PRIMARY KEY NOT NULL,
	"propiedad_id" integer NOT NULL,
	"tipo" "tipo_pago" NOT NULL,
	"impuesto_id" integer,
	"periodo" date NOT NULL,
	"monto_correspondiente" numeric(12, 2) NOT NULL,
	"fecha_vencimiento" date NOT NULL,
	"monto_pagado" numeric(12, 2),
	"fecha_pago" date,
	"recargo_aplicado" numeric(12, 2),
	"metodo_pago" "metodo_pago"
);
--> statement-breakpoint
CREATE TABLE "propiedades" (
	"id" serial PRIMARY KEY NOT NULL,
	"propietario_id" integer NOT NULL,
	"inquilino_actual" text,
	"contacto_inquilino" text,
	"inquilino_anterior" text,
	"direccion" text NOT NULL,
	"monto_inicial" numeric(12, 2) NOT NULL,
	"fecha_inicio_contrato" date NOT NULL,
	"fecha_fin_contrato" date NOT NULL,
	"frecuencia_aumento" integer NOT NULL,
	"monto_actual" numeric(12, 2) NOT NULL,
	"deuda_acumulada" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estado" "estado_propiedad" DEFAULT 'activa' NOT NULL,
	"contrato_pdf_url" text
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ajustes_alquiler" ADD CONSTRAINT "ajustes_alquiler_propiedad_id_propiedades_id_fk" FOREIGN KEY ("propiedad_id") REFERENCES "public"."propiedades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_propiedad_id_propiedades_id_fk" FOREIGN KEY ("propiedad_id") REFERENCES "public"."propiedades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impuestos" ADD CONSTRAINT "impuestos_propiedad_id_propiedades_id_fk" FOREIGN KEY ("propiedad_id") REFERENCES "public"."propiedades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_propiedad_id_propiedades_id_fk" FOREIGN KEY ("propiedad_id") REFERENCES "public"."propiedades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_impuesto_id_impuestos_id_fk" FOREIGN KEY ("impuesto_id") REFERENCES "public"."impuestos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propiedades" ADD CONSTRAINT "propiedades_propietario_id_usuarios_id_fk" FOREIGN KEY ("propietario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;