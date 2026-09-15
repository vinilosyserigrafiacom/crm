# CRM · Vinilos y Serigrafía

Aplicación web de gestión para el taller de [vinilosyserigrafia.com](https://vinilosyserigrafia.com):
clientes, presupuestos y pedidos, con la numeración y los datos fiscales
preparados para añadir facturación conforme a Verifactu más adelante.

Es una aplicación autoalojada: se ejecuta en un servidor propio o en un VPS, y
todos los datos se quedan en un fichero o en una base de datos que controlas tú.

## Qué hace

- **Clientes.** Fichas de empresa o particular con NIF/CIF validado, varios
  contactos y varias direcciones (facturación, envío, instalación), condiciones
  de pago, etiquetas y notas internas. Los clientes se archivan, nunca se
  borran, para no dejar documentos huérfanos.
- **Presupuestos.** Editor con líneas, precios en euros, descuentos por línea y
  globales, varios tipos de IVA en el mismo documento y totales en vivo. Estados
  de borrador a enviado, aceptado, rechazado, caducado o anulado. Vista
  imprimible para mandar el PDF al cliente.
- **Pedidos.** Nacen de un presupuesto aceptado con un clic, o directamente si
  no hubo presupuesto. Estados de taller (confirmado, en producción, listo,
  entregado) y fecha de entrega comprometida, con aviso de retrasos.
- **Catálogo.** Los trabajos y materiales que se repiten, con precio, coste y
  margen, para rellenar líneas de presupuesto sin teclear.
- **Resumen.** Lo que hay abierto: presupuestos sin respuesta, pedidos en curso,
  entregas de la semana y tasa de aceptación de los últimos 90 días.

## Puesta en marcha

Requisitos: [Node.js](https://nodejs.org) 20 o superior y Git. Probado sobre
Node 22.22 y 24.21 (la LTS actual); con cualquiera de las dos va igual.

```bash
git clone https://github.com/vinilosyserigrafiacom/crm.git
cd crm
npm run setup
npm run dev
```

`npm run setup` instala las dependencias, crea el `.env` con una clave de
sesión generada al azar, aplica las migraciones y carga el catálogo y los datos
de ejemplo. Al terminar imprime el usuario y la contraseña de acceso:

```
Usuario:    admin@vinilosyserigrafia.com
Contraseña: fXjoAQMmOXt5
```

**Anota esa contraseña: no se vuelve a mostrar.** Puedes fijarla tú de antemano
con `SEED_ADMIN_PASSWORD` (mínimo 10 caracteres) y el correo con
`SEED_ADMIN_EMAIL`.

El comando se puede repetir sin miedo: no pisa un `.env` que ya exista ni
vuelve a sembrar una base de datos que ya tenga usuarios.

Con `npm run dev` la aplicación queda en http://localhost:3000.

Nada más entrar, en **Ajustes**: cambia la contraseña y rellena los datos del
taller (CIF, dirección, IBAN), que son los que salen en la cabecera de los
presupuestos. Los cuatro clientes de ejemplo son inventados; bórralos cuando
hayas visto cómo funciona.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run setup` | Instalación completa desde cero (idempotente) |
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` / `npm start` | Compilar y servir en producción |
| `npm run check` | Tipos, linter y pruebas de una tacada |
| `npm test` | Pruebas del cálculo de importes y de la validación de NIF |
| `npm run db:migrate` | Crear una migración nueva tras tocar el esquema |
| `npm run db:deploy` | Aplicar migraciones en producción |
| `npm run db:seed` | Datos iniciales (no hace nada si ya hay usuarios) |
| `npm run db:reset` | Vaciar la base de datos y volver a sembrarla |
| `npm run db:studio` | Explorador visual de la base de datos |

## Despliegue autoalojado

La aplicación es un servidor Node normal. Con SQLite no hace falta nada más:

1. Clona el repositorio en el servidor y ejecuta `npm run setup`.
2. Edita el `.env` que ha creado: `APP_URL` con tu dominio y **https**. Sin
   https la cookie de sesión viaja en claro.
3. `npm run build`.
4. Arranca con un gestor de procesos (systemd, pm2…) y pon delante un proxy
   inverso (nginx, Caddy) que termine el TLS.
5. Copia de seguridad: con SQLite basta con copiar el fichero de la base de
   datos. Hazlo con `sqlite3 dev.db ".backup copia.db"` y no con `cp`, para no
   copiarla a medio escribir.

`GET /api/health` responde `200` con el estado de la base de datos, para el
monitor del servidor. Es la única ruta que no exige sesión.

### PostgreSQL

Para varios usuarios simultáneos escribiendo a la vez, PostgreSQL aguanta mejor
que SQLite:

1. En `prisma/schema.prisma`, cambia `provider = "sqlite"` por `"postgresql"`.
2. Pon la URL de conexión en `DATABASE_URL`.
3. Borra la carpeta `prisma/migrations` y ejecuta `npm run db:migrate`.

El esquema no usa nada específico de SQLite, así que no hay más cambios.

## Decisiones que conviene conocer antes de tocar el código

**El dinero son enteros.** Todos los importes se guardan en céntimos, y los
porcentajes en puntos base (21% → 2100). No hay ni un `Float` que represente
dinero. Todo el cálculo está en `src/lib/money.ts`, que es el módulo con más
pruebas del proyecto porque es el único que, si falla, produce un documento con
valor legal equivocado.

**El IVA se calcula por tipo, no por línea.** Se agrupan las bases por tipo de
IVA y se redondea una vez por grupo. Sumar el IVA línea a línea descuadra los
documentos largos por céntimos. El descuento global se reparte entre los grupos
con el método del resto mayor, de forma que la suma de bases siempre es
exactamente el subtotal menos el descuento.

**Los totales los calcula el servidor.** Lo que ves mientras rellenas el
formulario es un avance calculado en el navegador; al guardar, el servidor
recalcula todo a partir de cantidad, precio, descuento e IVA. Nada de lo que
envía el navegador se guarda como total.

**Los números se asignan al emitir, no al crear.** Un borrador no tiene número.
Se le asigna al enviarlo o aceptarlo, dentro de la misma transacción, para que
la serie no tenga huecos aunque se descarten borradores. Verifactu exige
numeración correlativa sin huecos, y este es el mecanismo que la garantiza.

**Los documentos emitidos congelan sus datos.** Al numerar un documento se
guarda una copia (`billingSnapshot`) del emisor y del cliente tal como estaban.
Cambiar mañana la dirección de un cliente no reescribe un presupuesto de hace
dos años.

**Hay un registro encadenado.** Cada movimiento (`AuditLog`) guarda el hash del
anterior. Borrar o alterar una entrada rompe la cadena, y Ajustes → Integridad
del registro lo detecta. Es la misma propiedad que Verifactu exigirá a los
registros de facturación; se estrena aquí con clientes, presupuestos y pedidos
para que el mecanismo esté rodado cuando se añadan las facturas.

**Nada se borra de verdad.** Clientes y artículos se archivan o desactivan.
Solo se pueden borrar los borradores que nunca han tenido número.

## Qué falta para facturar

El modelo de datos ya contempla las facturas (`NumberSequence` tiene el tipo
`INVOICE`, los clientes tienen tipo de identificador fiscal, causa de exención y
retención, y el registro encadenado está en marcha). Para cerrar el círculo
haría falta:

- Modelo `Invoice` / `InvoiceLine`, calcados de `Order` / `OrderLine`, con la
  factura inmutable una vez emitida y las rectificativas como documento aparte.
- Firma y envío de los registros de alta y anulación a la AEAT, y el código QR
  obligatorio en la factura.
- Vencimientos y control de cobros.

El resto de la infraestructura (numeración, cálculo, copias congeladas,
trazabilidad) ya está construida y probada.

## Estructura

```
prisma/
  schema.prisma        Modelo de datos, con las convenciones documentadas
  seed.ts              Datos iniciales
scripts/
  setup.mjs            Instalación en un solo comando
src/
  app/
    (app)/             Páginas con sesión: resumen, clientes, presupuestos…
    login/             Acceso
    api/health         Comprobación de estado para el monitor
  components/          Editor de documentos, hoja imprimible, navegación
  lib/
    money.ts           Cálculo de importes (con pruebas)
    documents.ts       Lógica común de presupuestos y pedidos
    numbering.ts       Series correlativas
    audit.ts           Registro encadenado por hash
    tax-id.ts          Validación de NIF, NIE y CIF (con pruebas)
    validation.ts      Estados permitidos y esquemas de formulario
```
