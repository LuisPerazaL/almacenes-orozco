# Almacenes Orozco

Inventario, pedidos, stock y reabastecimiento. Next.js para Vercel y PostgreSQL mediante Supabase.

## Configuración

1. Ejecuta `supabase/schema.sql` en el SQL Editor de Supabase.
2. Configura en Vercel `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Importa este repositorio desde Vercel y despliega.

La aplicación utiliza Supabase Auth y RLS. No utiliza ni expone la llave `service_role`.
