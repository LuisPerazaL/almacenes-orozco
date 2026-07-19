# Almacenes Orozco

Inventario, pedidos, stock y reabastecimiento. Next.js para Vercel y PostgreSQL mediante Supabase.

## Configuración

1. Ejecuta `supabase/schema.sql` en el SQL Editor de Supabase.
2. Configura en Vercel `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Importa este repositorio desde Vercel y despliega.

La `SUPABASE_SERVICE_ROLE_KEY` es secreta: agrégala únicamente como variable de entorno en Vercel.
