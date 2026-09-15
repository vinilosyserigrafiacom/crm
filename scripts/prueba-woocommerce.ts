/**
 * Prueba de extremo a extremo del importador de WooCommerce.
 *
 * Levanta un servidor que imita la API de la tienda —incluida la paginación por
 * cabecera `X-WP-TotalPages`— y ejecuta la sincronización de verdad contra una
 * base de datos temporal. Sin esto, la reconciliación solo estaría probada por
 * partes: es la única forma, sin una tienda real, de comprobar que reimportar
 * no duplica, que importar no gasta numeración y que la tienda no pisa el
 * trabajo del taller.
 *
 *     npm run test:woo
 *
 * La base de datos se crea en un directorio temporal y se borra al terminar,
 * así que no toca nunca la del taller por mucho que valga `DATABASE_URL`.
 */

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Base de datos de usar y tirar -----------------------------------------
//
// Hay que fijar DATABASE_URL antes de importar nada que abra Prisma, porque el
// cliente de `src/lib/prisma.ts` se construye al cargar el módulo. De ahí que
// los imports del CRM se hagan más abajo con `await import()`.

const directorio = mkdtempSync(join(tmpdir(), "crm-woo-"));
process.env.DATABASE_URL = `file:${join(directorio, "prueba.db")}`;

execFileSync("npx", ["prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });

// --- Datos de la tienda simulada -------------------------------------------

const clientes = [
  {
    id: 7,
    email: "nuria@arribas.example",
    first_name: "Nuria",
    last_name: "Arribas",
    billing: {
      first_name: "Nuria",
      last_name: "Arribas",
      company: "Talleres Arribas S.L.",
      address_1: "Calle Plata 14",
      city: "Valladolid",
      state: "VA",
      postcode: "47012",
      country: "ES",
      email: "nuria@arribas.example",
      phone: "620112233",
    },
    meta_data: [{ key: "_billing_nif", value: "B47286158" }],
  },
  {
    id: 8,
    email: "alberto@example.com",
    first_name: "Alberto",
    last_name: "Cuesta",
    billing: {
      first_name: "Alberto",
      last_name: "Cuesta",
      company: "",
      address_1: "Calle Zurradores 22",
      city: "Valladolid",
      state: "VA",
      postcode: "47005",
      country: "ES",
      email: "alberto@example.com",
    },
    meta_data: [],
  },
];

/** Estado mutable de los pedidos, para poder simular cambios en la tienda. */
const pedidos = [
  {
    id: 1001,
    number: "1001",
    status: "processing",
    currency: "EUR",
    date_created_gmt: "2026-09-10T08:30:00",
    customer_id: 7,
    total: "121.00",
    total_tax: "21.00",
    billing: clientes[0].billing,
    line_items: [
      {
        name: "Vinilo impreso",
        sku: "VIN-IMP-M2",
        quantity: 2,
        subtotal: "100.00",
        subtotal_tax: "21.00",
        total: "100.00",
        total_tax: "21.00",
      },
    ],
    shipping_lines: [],
    meta_data: [],
  },
  {
    id: 1002,
    number: "1002",
    status: "pending",
    currency: "EUR",
    date_created_gmt: "2026-09-12T10:00:00",
    customer_id: 8,
    total: "36.30",
    total_tax: "6.30",
    billing: clientes[1].billing,
    line_items: [
      {
        name: "Lona banner",
        sku: "LON-BAN-M2",
        quantity: 1,
        subtotal: "25.00",
        subtotal_tax: "5.25",
        total: "25.00",
        total_tax: "5.25",
      },
    ],
    shipping_lines: [{ method_title: "Envío estándar", total: "5.00", total_tax: "1.05" }],
    meta_data: [],
  },
  {
    // Pedido de invitado: sin cuenta en la tienda.
    id: 1003,
    number: "1003",
    status: "completed",
    currency: "EUR",
    date_created_gmt: "2026-09-13T16:45:00",
    customer_id: 0,
    total: "60.50",
    total_tax: "10.50",
    billing: {
      first_name: "Marta",
      last_name: "Sanz",
      company: "",
      address_1: "Calle Mayor 8",
      city: "Burgos",
      state: "BU",
      postcode: "09001",
      country: "ES",
      email: "marta@example.com",
      phone: "610554433",
    },
    line_items: [
      {
        name: "Vinilo de corte",
        sku: "VIN-COR-M2",
        quantity: 1,
        subtotal: "50.00",
        subtotal_tax: "10.50",
        total: "50.00",
        total_tax: "10.50",
      },
    ],
    shipping_lines: [],
    meta_data: [],
  },
];

/** Los pedidos se sirven de dos en dos para ejercitar la paginación. */
const POR_PAGINA = 2;

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (!req.headers.authorization?.startsWith("Basic ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "sin credenciales" }));
    return;
  }

  const pagina = Number(url.searchParams.get("page") ?? "1");

  const responder = (todos: unknown[]) => {
    const totalPaginas = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
    const trozo = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-WP-Total": String(todos.length),
      "X-WP-TotalPages": String(totalPaginas),
    });
    res.end(JSON.stringify(trozo));
  };

  if (url.pathname === "/wp-json/wc/v3/customers") return responder(clientes);
  if (url.pathname === "/wp-json/wc/v3/orders") return responder(pedidos);

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "no existe" }));
});

// --- Comprobaciones ---------------------------------------------------------

const fallos: string[] = [];

function comprobar(etiqueta: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${bien ? "✓" : "✗"} ${etiqueta.padEnd(52)} ${JSON.stringify(real)}`);
  if (!bien) {
    fallos.push(`${etiqueta}: esperaba ${JSON.stringify(esperado)}, hay ${JSON.stringify(real)}`);
  }
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { runWooSync } = await import("../src/lib/woo-sync");
  const prisma = new PrismaClient();

  // El puerto lo elige el sistema: así dos ejecuciones a la vez no chocan.
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === "string") {
    throw new Error("el servidor de prueba no ha arrancado");
  }
  const config = {
    baseUrl: `http://127.0.0.1:${direccion.port}`,
    consumerKey: "ck_prueba",
    consumerSecret: "cs_prueba",
  };

  // --- 1. Importación completa ---------------------------------------------
  console.log("\n1. IMPORTACIÓN COMPLETA");
  const primera = await runWooSync({ config, since: null, userId: null });
  comprobar("clientes creados", primera.customersCreated, 3); // 2 con cuenta + 1 invitado
  comprobar("pedidos creados", primera.ordersCreated, 3);
  comprobar("avisos", primera.warnings.length, 0);

  const pedido1001 = await prisma.order.findUnique({
    where: { wooId: 1001 },
    include: { lines: true, customer: true },
  });
  comprobar("no gasta numeración del CRM", pedido1001?.number, null);
  comprobar("conserva el número de la tienda", pedido1001?.wooNumber, "1001");
  comprobar("origen marcado", pedido1001?.source, "WOOCOMMERCE");
  comprobar("estado traducido", pedido1001?.status, "CONFIRMED");
  comprobar("total calculado", pedido1001?.total, 12_100);
  comprobar("IVA deducido de la línea", pedido1001?.lines[0].vatRate, 2100);
  comprobar("cliente enlazado", pedido1001?.customer.legalName, "Talleres Arribas S.L.");
  comprobar("NIF importado", pedido1001?.customer.taxId, "B47286158");
  comprobar(
    "provincia traducida",
    (
      await prisma.address.findFirst({
        where: { customerId: pedido1001?.customerId },
        select: { province: true },
      })
    )?.province,
    "Valladolid",
  );

  const pedido1002 = await prisma.order.findUnique({
    where: { wooId: 1002 },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  comprobar("los portes entran como línea", pedido1002?.lines.length, 2);
  comprobar("total con portes", pedido1002?.total, 3_630);

  const invitado = await prisma.order.findUnique({
    where: { wooId: 1003 },
    include: { customer: true },
  });
  comprobar("pedido de invitado con cliente creado", invitado?.customer.legalName, "Marta Sanz");
  comprobar("invitado sin wooId de cliente", invitado?.customer.wooId, null);

  const consentimiento = await prisma.customer.findFirst({
    where: { wooId: 7 },
    select: { marketingConsentAt: true, marketingOptOut: true },
  });
  comprobar("comprar no da consentimiento", consentimiento?.marketingConsentAt, null);
  comprobar("ni marca baja", consentimiento?.marketingOptOut, false);

  // --- 2. Reimportación sin cambios ----------------------------------------
  console.log("\n2. REIMPORTACIÓN SIN CAMBIOS (idempotencia)");
  const segunda = await runWooSync({ config, since: null, userId: null });
  comprobar("no crea clientes de nuevo", segunda.customersCreated, 0);
  comprobar("no crea pedidos de nuevo", segunda.ordersCreated, 0);
  comprobar("total de pedidos en la base", await prisma.order.count(), 3);
  comprobar("total de clientes en la base", await prisma.customer.count(), 3);

  // --- 3. El taller mueve un pedido y la tienda lo cambia ------------------
  console.log("\n3. EL TALLER MANDA SOBRE LA TIENDA");
  await prisma.order.update({
    where: { wooId: 1001 },
    data: { status: "IN_PRODUCTION" },
  });
  pedidos[0].status = "completed"; // la tienda lo marca como enviado

  const tercera = await runWooSync({ config, since: null, userId: null });
  const trasDivergir = await prisma.order.findUnique({
    where: { wooId: 1001 },
    select: { status: true, wooStatus: true },
  });
  comprobar("respeta el estado del taller", trasDivergir?.status, "IN_PRODUCTION");
  comprobar("pero anota lo que dice la tienda", trasDivergir?.wooStatus, "completed");
  comprobar("y lo cuenta como respetado", tercera.ordersSkipped, 1);

  // --- 4. Cambio de importe en la tienda -----------------------------------
  console.log("\n4. LA TIENDA CAMBIA UN IMPORTE");
  pedidos[1].line_items[0].subtotal = "40.00";
  pedidos[1].line_items[0].total = "40.00";
  pedidos[1].line_items[0].total_tax = "8.40";
  pedidos[1].total = "54.45";

  await runWooSync({ config, since: null, userId: null });
  const actualizado = await prisma.order.findUnique({
    where: { wooId: 1002 },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  comprobar("refresca el importe de la línea", actualizado?.lines[0].unitPrice, 4_000);
  comprobar("y el total del pedido", actualizado?.total, 5_445);
  comprobar("sin duplicar líneas", actualizado?.lines.length, 2);

  // --- 5. Un cliente que ya existía a mano ---------------------------------
  console.log("\n5. CLIENTE QUE YA EXISTÍA DADO DE ALTA A MANO");
  const aMano = await prisma.customer.create({
    data: {
      code: "C-9001",
      legalName: "Cliente dado de alta antes",
      email: "nuevo-en-la-tienda@example.com",
      tags: "importante",
      marketingConsentAt: new Date(),
    },
  });
  clientes.push({
    id: 99,
    email: "nuevo-en-la-tienda@example.com",
    first_name: "Ya",
    last_name: "Existía",
    billing: {
      first_name: "Ya",
      last_name: "Existía",
      company: "",
      address_1: "Calle Nueva 1",
      city: "Palencia",
      state: "P",
      postcode: "34001",
      country: "ES",
      email: "nuevo-en-la-tienda@example.com",
      phone: "",
    },
    meta_data: [],
  });

  await runWooSync({ config, since: null, userId: null });
  const enlazado = await prisma.customer.findUnique({ where: { id: aMano.id } });
  comprobar("enlaza en vez de duplicar", enlazado?.wooId, 99);
  comprobar("conserva las etiquetas del taller", enlazado?.tags, "importante");
  comprobar("y el consentimiento", enlazado?.marketingConsentAt !== null, true);
  comprobar(
    "no hay cliente duplicado",
    await prisma.customer.count({ where: { email: "nuevo-en-la-tienda@example.com" } }),
    1,
  );

  // --- 6. Rastro de auditoría ----------------------------------------------
  console.log("\n6. LA IMPORTACIÓN DEJA RASTRO");
  const rastro = await prisma.auditLog.count({ where: { entity: "Order" } });
  comprobar("hay apuntes de pedidos en el registro", rastro > 0, true);

  // --- 7. La tienda no responde --------------------------------------------
  console.log("\n7. LA TIENDA NO RESPONDE");
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  try {
    await runWooSync({ config, since: null, userId: null });
    fallos.push("una tienda caída debería lanzar un error y no lo ha hecho");
    console.log("  ✗ debería haber fallado");
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    const util = mensaje.includes("conectar") || mensaje.includes("tienda");
    console.log(`  ${util ? "✓" : "✗"} error legible: ${mensaje.slice(0, 70)}`);
    if (!util) fallos.push("el error de conexión no es comprensible");
  }

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    fallos.push("la prueba ha reventado antes de terminar");
  })
  .finally(() => {
    rmSync(directorio, { recursive: true, force: true });
    console.log(
      "\n" +
        (fallos.length
          ? "FALLOS:\n- " + fallos.join("\n- ")
          : "El importador se comporta como debe."),
    );
    process.exit(fallos.length ? 1 : 0);
  });
