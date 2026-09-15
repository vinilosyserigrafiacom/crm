# Notas para trabajar en este repositorio

CRM autoalojado para un taller de vinilo y serigrafía. Next.js 15 (App Router),
Prisma sobre SQLite, Tailwind v4. Interfaz y código en castellano: nombres de
ruta, textos y comentarios en castellano; identificadores de código en inglés,
como en el resto del ecosistema.

## Puesta en marcha

`npm run setup` deja un clon listo para `npm run dev`. Es idempotente y está en
`scripts/setup.mjs`; si cambias los pasos de instalación, actualízalo ahí y no
solo en el README.

## Antes de dar algo por terminado

```bash
npm run check     # tipos + linter + pruebas
npm run build     # el build detecta errores que tsc no ve, como los de Tailwind
```

## Reglas que no se negocian

**Dinero en enteros.** Importes en céntimos, porcentajes en puntos base
(21% → 2100). Ni un `Float` que represente dinero. Todo el cálculo vive en
`src/lib/money.ts`; si lo tocas, las pruebas de ese módulo tienen que seguir en
verde y probablemente haya que añadir alguna.

**El servidor recalcula siempre.** `prepareDocument()` en `src/lib/documents.ts`
recalcula todos los importes al guardar. Nunca guardes un total que venga del
navegador.

**IVA por grupo de tipo, no por línea.** Ver `computeDocumentTotals()`. El
descuento global se reparte por resto mayor para que las bases cuadren al
céntimo.

**Numerar solo al emitir.** `reserveDocumentNumber()` se llama dentro de la
transacción que emite el documento. Un borrador no tiene número. La serie no
puede tener huecos.

**No borrar lo que tiene valor contable.** Clientes y artículos se archivan.
Solo se borran borradores sin número.

**Toda mutación deja rastro.** Las acciones de servidor llaman a `recordAudit()`
dentro de su transacción. La cadena de hashes se comprueba desde Ajustes.

**Una baja de newsletter manda siempre.** `marketingOptOut` excluye al cliente o
al contacto de todos los grupos, por encima de cualquier regla y del propio
ajuste del grupo. La baja del cliente arrastra también a sus contactos. Y las
listas de destinatarios no se guardan nunca: se resuelven al mirarlas, para que
una baja no dependa de refrescar nada.

**La tienda no pisa el taller.** Un pedido importado de WooCommerce conserva el
número de la tienda y no gasta numeración de la serie. La sincronización
refresca siempre las líneas y los importes —eso solo lo sabe la tienda— pero el
estado solo se aplica mientras el taller no lo haya tocado: ver `decideStatus()`
en `src/lib/woo-sync.ts`. Y nunca toca `internalNotes`, `dueDate`,
`boardPosition`, las etiquetas, el consentimiento ni la baja de newsletter.

## Cómo está organizado

- Las mutaciones son **server actions** en `actions.ts` junto a cada módulo, no
  rutas de API. Los formularios usan `useActionState` y devuelven `FormState`
  (`src/lib/form.ts`) con `error`, `errors` por campo, `message` y `values`.
- **Todo campo lleva `defaultValue={prefill(state, "nombre", valor)}`** (y
  `prefillChecked` en las casillas). React 19 resetea el formulario en cuanto
  termina la acción: sin esto, un error de validación borra lo tecleado en un
  alta y revierte a lo guardado en una edición, sin avisar. Por el otro lado,
  toda acción que devuelva un error tiene que arrastrar los valores: pasa el
  `formData` a `parseForm(schema, input, formData)` y usa `snapshotValues` en
  los errores que construyas a mano. Las contraseñas nunca se devuelven.
- La validación es Zod en `src/lib/validation.ts`. SQLite no soporta enums de
  Prisma, así que los estados se guardan como texto y ese fichero es la única
  fuente de verdad de los valores y de las transiciones permitidas.
- Presupuestos y pedidos comparten el editor (`components/document-editor.tsx`),
  la hoja imprimible (`components/document-sheet.tsx`) y la preparación de datos
  (`lib/documents.ts`). Si añades un campo a uno, mira si el otro lo necesita.
- Los estilos van en clases de componente en `globals.css` (`.card`, `.btn-*`,
  `.input`, `.pill-*`, `.table`). Úsalas antes de inventar utilidades sueltas.
  `btn`, `input` y `pill` son `@utility` porque el resto las reutiliza con
  `@apply`, y Tailwind v4 no admite `@apply` de clases de componente.
- Las tablas van dentro de `.table-wrap`. Si una tabla queda dentro de un `div`
  que es elemento de rejilla, ese `div` necesita `min-w-0` o la tabla saca
  scroll horizontal a toda la página en móvil.
- **Cuidado con `sr-only` dentro de contenedores con scroll horizontal.** Es
  `position:absolute`, y sin un ancestro posicionado su bloque contenedor pasa a
  ser el viewport: deja de estar recortado y estira el documento a lo ancho
  aunque no se vea nada. Por eso `.card` lleva `relative`. Si metes un `sr-only`
  fuera de una tarjeta y dentro de algo con scroll, posiciona su contenedor.
- El tablero y el calendario (`src/app/(app)/taller/`) usan la API de arrastre
  del navegador, sin librería. No funciona con el dedo, así que **cualquier cosa
  que se pueda hacer arrastrando tiene que poder hacerse también sin arrastrar**:
  el menú «Mover a…» de las tarjetas no es un extra, es la vía principal en el
  móvil del taller.
- Las acciones de `taller/actions.ts` reciben un objeto y no un `FormData`,
  porque las llama el código de arrastre. Siguen siendo endpoints públicos: se
  validan con Zod igual que un formulario.
- El cambio de estado de un pedido vive en `src/lib/orders-server.ts` y lo usan
  la ficha y el tablero. No lo dupliques: si divergen, arrastrar una tarjeta y
  pulsar un botón numerarían de forma distinta.

## Al cambiar el esquema

```bash
npm run db:migrate    # crea y aplica la migración
```

Las migraciones se comiten. Si añades un tipo de documento, añádelo también a
`DOC_TYPES` y al mapa de prefijos de `src/lib/numbering.ts`.

## Newsletters

`src/lib/segments.ts` tiene la parte con reglas, y está separada en dos a
propósito: `recipientsForCustomer()` es pura y decide quién recibe un correo
—esa es la que hay que probar cuando la toques—, y `resolveAudience()` pone la
consulta alrededor. La exportación a CSV neutraliza las fórmulas (`=`, `+`, `-`,
`@`) porque los nombres los teclea una persona y el fichero se abre en Excel.

## WooCommerce

La integración es de solo lectura y va en tres capas separadas a propósito:
`woocommerce.ts` habla con la API (paginación por `X-WP-TotalPages`, errores en
castellano), `woo-mapping.ts` traduce sin tocar la base de datos —es la parte
que hay que probar cuando cambie algo— y `woo-sync.ts` pone las transacciones
alrededor, una por registro para que un pedido raro no tire abajo los cien
anteriores.

Las credenciales viven **solo en variables de entorno**, nunca en la base de
datos: una clave de la tienda lee el fichero entero de clientes, y guardada en
la base viajaría en cada copia de seguridad. `readWooConfig()` es el único sitio
que las lee.

Un pedido importado **no se puede editar** en el CRM: sus líneas las reescribe
la siguiente sincronización, así que ofrecer el editor sería prometer un cambio
que se deshace solo. La ficha ofrece en su lugar estado, fecha de entrega y
notas internas, que son suyas. Si añades otro campo que el taller pueda tocar en
un pedido, comprueba que `upsertOrder()` no lo sobrescriba.

`npm run test:woo` (en `scripts/prueba-woocommerce.ts`) levanta una tienda
simulada y ejecuta el importador de verdad contra una base de datos temporal
que crea y borra sola. Es la prueba que cubre la reconciliación: reimportar sin
duplicar, no gastar numeración, respetar el estado del taller y enlazar por
correo con un cliente que ya existía. Si tocas `woo-sync.ts`, pásala.

## Lo que viene después

La facturación con Verifactu. El modelo ya tiene el tipo `INVOICE` en las
secuencias, los campos fiscales del cliente y el registro encadenado. Ver la
sección «Qué falta para facturar» del README antes de empezar.
