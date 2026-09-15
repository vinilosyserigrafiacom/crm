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

## Al cambiar el esquema

```bash
npm run db:migrate    # crea y aplica la migración
```

Las migraciones se comiten. Si añades un tipo de documento, añádelo también a
`DOC_TYPES` y al mapa de prefijos de `src/lib/numbering.ts`.

## Lo que viene después

La facturación con Verifactu. El modelo ya tiene el tipo `INVOICE` en las
secuencias, los campos fiscales del cliente y el registro encadenado. Ver la
sección «Qué falta para facturar» del README antes de empezar.
