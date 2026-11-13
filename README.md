# OSKI web

Versión web de OSKI: inventario, calendario y equipo técnico de una empresa. Usa las mismas cuentas y los mismos datos que la app de Mac.

## Qué hace

- **Acceso:** entrar con correo y contraseña, registro de empresa y de técnico con código de confirmación.
- **Calendario:** vista de mes del equipo o del inventario.
- **Proyectos, Ítems y Técnicos:** crear, editar y eliminar; reservar y liberar material; invitar técnicos.
- Lo que cada persona puede ver o cambiar depende del nivel que le dé su empresa (Básico, Colaborador o Encargado).

## Archivos

- `index.html`: la página.
- `styles.css`: estilos, con la misma estética que Light Image.
- `app.js`: toda la lógica.

No hay paso de compilación. La única dependencia externa es [supabase-js](https://github.com/supabase/supabase-js), cargada desde jsDelivr.

## Datos

Los datos están en Supabase. La dirección del proyecto y la clave pública van en `app.js`; es una clave pensada para ser pública, y la protección real son las reglas de permisos de la base de datos, definidas en los archivos `supabase/schema.sql` y `supabase/schema-datos.sql` del proyecto de la app de Mac.

## Probar en local

```bash
python3 -m http.server 8770
```

Abre http://localhost:8770.
