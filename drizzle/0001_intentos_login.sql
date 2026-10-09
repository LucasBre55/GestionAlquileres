CREATE TABLE "intentos_login" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
