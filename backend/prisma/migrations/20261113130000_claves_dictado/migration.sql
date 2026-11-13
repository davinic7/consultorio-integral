-- Dictado: par de claves de cada usuario en cada centro (decisiones.md §20). El
-- teléfono cifra las grabaciones con la pública; la privada queda acá, cifrada con
-- la clave de datos del centro.

-- CreateTable
CREATE TABLE "claves_dictado" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "publica" TEXT NOT NULL,
    "privada" TEXT NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claves_dictado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claves_dictado_centro_id_id_key" ON "claves_dictado"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "claves_dictado_centro_id_usuario_id_version_key" ON "claves_dictado"("centro_id", "usuario_id", "version");

-- Una sola clave vigente por usuario y centro (índice parcial, como config_fiscal).
CREATE UNIQUE INDEX "claves_dictado_una_vigente" ON "claves_dictado"("centro_id", "usuario_id") WHERE "vigente";

-- AddForeignKey
ALTER TABLE "claves_dictado" ADD CONSTRAINT "claves_dictado_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_dictado" ADD CONSTRAINT "claves_dictado_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
