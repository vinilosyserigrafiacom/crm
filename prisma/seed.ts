/**
 * Datos iniciales.
 *
 * Crea la cuenta de acceso, los datos del emisor, un catálogo de partida con
 * los trabajos habituales de un taller de vinilo y serigrafía, y unos clientes
 * y documentos de ejemplo para poder ver las pantallas con contenido.
 *
 * Se ejecuta con: npm run db:seed
 *
 * Es seguro volver a ejecutarlo: si ya hay usuarios, no toca nada.
 */

import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeDocumentTotals, computeLine } from "../src/lib/money";

const prisma = new PrismaClient();

/** Precio en euros a céntimos, para que la semilla se lea en euros. */
const eur = (amount: number) => Math.round(amount * 100);

const CATALOG = [
  {
    sku: "VIN-IMP-M2",
    name: "Vinilo impreso",
    description: "Impresión digital sobre vinilo monomérico, laminado brillo",
    category: "Vinilo",
    kind: "PRODUCT",
    unit: "m2",
    unitPrice: eur(28),
    unitCost: eur(11.5),
  },
  {
    sku: "VIN-COR-M2",
    name: "Vinilo de corte",
    description: "Vinilo polimérico de corte, color plano",
    category: "Vinilo",
    kind: "PRODUCT",
    unit: "m2",
    unitPrice: eur(22),
    unitCost: eur(8),
  },
  {
    sku: "VIN-MIC-M2",
    name: "Vinilo microperforado",
    description: "Para escaparates y lunas, visión unidireccional",
    category: "Vinilo",
    kind: "PRODUCT",
    unit: "m2",
    unitPrice: eur(34),
    unitCost: eur(15),
  },
  {
    sku: "SER-PAN-1T",
    name: "Serigrafía textil 1 tinta",
    description: "Estampación a una tinta, precio por prenda",
    category: "Serigrafía",
    kind: "SERVICE",
    unit: "ud",
    unitPrice: eur(2.4),
    unitCost: eur(0.8),
  },
  {
    sku: "SER-PAN-4T",
    name: "Serigrafía textil 4 tintas",
    description: "Estampación a cuatro tintas, precio por prenda",
    category: "Serigrafía",
    kind: "SERVICE",
    unit: "ud",
    unitPrice: eur(6.2),
    unitCost: eur(2.4),
  },
  {
    sku: "SER-PANT",
    name: "Preparación de pantalla",
    description: "Insolado y preparación de pantalla por tinta",
    category: "Serigrafía",
    kind: "SERVICE",
    unit: "ud",
    unitPrice: eur(18),
    unitCost: eur(6),
  },
  {
    sku: "ROT-INST-H",
    name: "Instalación y montaje",
    description: "Mano de obra de instalación en el sitio del cliente",
    category: "Rotulación",
    kind: "SERVICE",
    unit: "hora",
    unitPrice: eur(35),
    unitCost: eur(18),
  },
  {
    sku: "DIS-ARTE-H",
    name: "Diseño y arte final",
    description: "Adaptación de archivos y preparación para producción",
    category: "Diseño",
    kind: "SERVICE",
    unit: "hora",
    unitPrice: eur(40),
    unitCost: eur(0),
  },
  {
    sku: "PLA-FOAM-M2",
    name: "Panel foam 5 mm impreso",
    description: "Panel ligero impreso a una cara, cortado a medida",
    category: "Rígidos",
    kind: "PRODUCT",
    unit: "m2",
    unitPrice: eur(31),
    unitCost: eur(14),
  },
  {
    sku: "LON-BAN-M2",
    name: "Lona banner con ojales",
    description: "Lona 510 g impresa, dobladillo y ojales cada 50 cm",
    category: "Rígidos",
    kind: "PRODUCT",
    unit: "m2",
    unitPrice: eur(19),
    unitCost: eur(7),
  },
];

const CUSTOMERS = [
  {
    code: "C-0001",
    kind: "COMPANY",
    legalName: "Talleres Mecánicos Arribas S.L.",
    tradeName: "Talleres Arribas",
    taxId: "B47286158",
    email: "administracion@talleresarribas.example",
    phone: "983 45 67 89",
    paymentTermsDays: 30,
    tags: "rotulacion, recurrente",
    marketingConsentSource: "Casilla del formulario de contacto de la web",
    contact: { name: "Nuria Arribas", jobTitle: "Gerencia", phone: "620 11 22 33" },
    address: {
      line1: "Polígono San Cristóbal, calle Plata 14",
      postalCode: "47012",
      city: "Valladolid",
      province: "Valladolid",
    },
  },
  {
    code: "C-0002",
    kind: "COMPANY",
    legalName: "Club Deportivo Río Pisuerga",
    tradeName: "CD Río Pisuerga",
    taxId: "G47512348",
    email: "material@cdriopisuerga.example",
    phone: "983 22 33 44",
    paymentTermsDays: 15,
    tags: "textil, serigrafia",
    marketingConsentSource: "Alta en la feria de material deportivo",
    contact: { name: "Iván Redondo", jobTitle: "Coordinación", phone: "699 88 77 66" },
    address: {
      line1: "Avenida del Deporte 3",
      postalCode: "47014",
      city: "Valladolid",
      province: "Valladolid",
    },
  },
  {
    code: "C-0003",
    kind: "COMPANY",
    legalName: "Panadería La Espiga de Oro S.L.U.",
    tradeName: "La Espiga de Oro",
    taxId: "B09876541",
    email: "hola@laespigadeoro.example",
    phone: "947 11 22 33",
    paymentTermsDays: 0,
    tags: "escaparate",
    marketingConsentSource: undefined,
    contact: { name: "Marta Sanz", jobTitle: "Propiedad", phone: "610 55 44 33" },
    address: {
      line1: "Calle Mayor 8",
      postalCode: "09001",
      city: "Burgos",
      province: "Burgos",
    },
  },
  {
    code: "C-0004",
    kind: "INDIVIDUAL",
    legalName: "Alberto Cuesta Herrero",
    taxId: "12345678Z",
    email: "alberto.cuesta@example.com",
    phone: "656 78 90 12",
    paymentTermsDays: 0,
    tags: "particular",
    marketingConsentSource: undefined,
    address: {
      line1: "Calle Zurradores 22, 3º B",
      postalCode: "47005",
      city: "Valladolid",
      province: "Valladolid",
    },
  },
];

/** Construye las líneas de un documento con sus importes ya calculados. */
function buildLines(
  raw: { description: string; unit: string; quantity: number; unitPrice: number; vatRate?: number; discountRate?: number }[],
) {
  return raw.map((line, index) => {
    const input = {
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountRate: line.discountRate ?? 0,
      vatRate: line.vatRate ?? 2100,
    };
    return {
      position: index,
      sku: null,
      itemId: null,
      notes: null,
      description: line.description,
      unit: line.unit,
      ...input,
      ...computeLine(input),
    };
  });
}

function totalsFor(
  lines: { quantity: number; unitPrice: number; discountRate: number; vatRate: number }[],
  globalDiscountRate = 0,
) {
  const totals = computeDocumentTotals({ lines, globalDiscountRate });
  return {
    globalDiscountRate,
    linesSubtotal: totals.linesSubtotal,
    discountTotal: totals.discountTotal,
    taxableBase: totals.taxableBase,
    vatTotal: totals.vatTotal,
    withholdingTotal: totals.withholdingTotal,
    total: totals.total,
    vatBreakdown: JSON.stringify(totals.vatBreakdown),
  };
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log("Ya hay usuarios en la base de datos: no se toca nada.");
    return;
  }

  // La contraseña se toma del entorno o se genera al azar y se imprime. No hay
  // contraseña por defecto: una instalación con clave conocida en internet dura
  // horas.
  //
  // Se comprueba que no venga vacía ni demasiado corta: con ?? a secas, un
  // SEED_ADMIN_PASSWORD= sin valor en un script de despliegue crearía la cuenta
  // de propietario sin contraseña, y el fallo pasaría desapercibido.
  const fromEnv = (process.env.SEED_ADMIN_PASSWORD ?? "").trim();
  if (fromEnv !== "" && fromEnv.length < 10) {
    throw new Error("SEED_ADMIN_PASSWORD debe tener al menos 10 caracteres.");
  }
  const password = fromEnv === "" ? randomBytes(9).toString("base64url") : fromEnv;
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim() || "admin@vinilosyserigrafia.com";

  const admin = await prisma.user.create({
    data: {
      email,
      name: "Administración",
      role: "OWNER",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      legalName: "Vinilos y Serigrafía",
      tradeName: "vinilosyserigrafia.com",
      website: "https://vinilosyserigrafia.com",
      quoteValidDays: 30,
      quoteTerms:
        "Precios sin IVA. Validez de la oferta: 30 días. Plazo de entrega a confirmar al " +
        "aceptar el presupuesto. Se requiere arte final en vectorial o imagen a 150 ppp a tamaño real.",
    },
    update: {},
  });

  await prisma.item.createMany({ data: CATALOG });

  const items = await prisma.item.findMany({ select: { id: true, sku: true } });
  const itemId = (sku: string) => items.find((i) => i.sku === sku)?.id ?? null;

  for (const customer of CUSTOMERS) {
    await prisma.customer.create({
      data: {
        code: customer.code,
        kind: customer.kind,
        legalName: customer.legalName,
        tradeName: customer.tradeName ?? null,
        taxId: customer.taxId,
        email: customer.email,
        phone: customer.phone,
        paymentTermsDays: customer.paymentTermsDays,
        tags: customer.tags,
        // Solo los dos primeros han dado su consentimiento: así se ve en las
        // pantallas de newsletters la diferencia entre quien entra en un envío
        // comercial y quien no.
        marketingConsentSource: customer.marketingConsentSource,
        marketingConsentAt: customer.marketingConsentSource ? daysFromNow(-60) : null,
        contacts: customer.contact
          ? { create: { ...customer.contact, isPrimary: true } }
          : undefined,
        addresses: {
          create: { kind: "BILLING", isDefault: true, ...customer.address },
        },
      },
    });
  }
  // El contador arranca donde acaban los clientes de ejemplo, para que el
  // siguiente alta sea C-0005 y no repita un código.
  await prisma.numberSequence.create({
    data: { docType: "CUSTOMER", series: "C", year: 0, next: CUSTOMERS.length + 1 },
  });

  const customers = await prisma.customer.findMany({ select: { id: true, code: true } });
  const customerId = (code: string) => {
    const found = customers.find((c) => c.code === code);
    if (!found) throw new Error(`Falta el cliente ${code} en la semilla`);
    return found.id;
  };

  const year = new Date().getFullYear();

  // Presupuesto aceptado que ya tiene pedido en producción.
  const rotulacionLines = buildLines([
    {
      description: "Vinilo impreso — rotulación integral de furgoneta Renault Kangoo",
      unit: "m2",
      quantity: 7.5,
      unitPrice: eur(28),
    },
    {
      description: "Diseño y arte final — adaptación del logotipo a las dos laterales y portón",
      unit: "hora",
      quantity: 3,
      unitPrice: eur(40),
    },
    {
      description: "Instalación y montaje en nuestras instalaciones",
      unit: "hora",
      quantity: 4,
      unitPrice: eur(35),
    },
  ]);

  const rotulacion = await prisma.quote.create({
    data: {
      number: `PRE-A-${year}-0001`,
      series: "A",
      year,
      customerId: customerId("C-0001"),
      createdById: admin.id,
      status: "ACCEPTED",
      issueDate: daysFromNow(-18),
      validUntil: daysFromNow(12),
      sentAt: daysFromNow(-18),
      decidedAt: daysFromNow(-14),
      title: "Rotulación furgoneta Kangoo",
      notes: "Incluye desmontaje de la rotulación anterior.",
      ...totalsFor(rotulacionLines),
      lines: {
        create: rotulacionLines.map((line) => ({
          ...line,
          sku: "VIN-IMP-M2",
          itemId: itemId("VIN-IMP-M2"),
        })),
      },
    },
  });

  await prisma.order.create({
    data: {
      number: `PED-A-${year}-0001`,
      series: "A",
      year,
      customerId: customerId("C-0001"),
      quoteId: rotulacion.id,
      createdById: admin.id,
      status: "IN_PRODUCTION",
      orderDate: daysFromNow(-14),
      dueDate: daysFromNow(3),
      title: "Rotulación furgoneta Kangoo",
      internalNotes: "Vinilo pedido el lunes, entra el jueves. Reservar cabina el viernes.",
      ...totalsFor(rotulacionLines),
      lines: { create: rotulacionLines },
    },
  });

  // Presupuesto enviado, esperando respuesta, con descuento por volumen.
  const textilLines = buildLines([
    {
      description: "Serigrafía textil 4 tintas — camisetas de entrenamiento, escudo en pecho",
      unit: "ud",
      quantity: 120,
      unitPrice: eur(6.2),
    },
    {
      description: "Serigrafía textil 1 tinta — dorsal numerado",
      unit: "ud",
      quantity: 120,
      unitPrice: eur(2.4),
    },
    {
      description: "Preparación de pantallas (5 tintas)",
      unit: "ud",
      quantity: 5,
      unitPrice: eur(18),
    },
  ]);

  await prisma.quote.create({
    data: {
      number: `PRE-A-${year}-0002`,
      series: "A",
      year,
      customerId: customerId("C-0002"),
      createdById: admin.id,
      status: "SENT",
      issueDate: daysFromNow(-6),
      validUntil: daysFromNow(2),
      sentAt: daysFromNow(-6),
      title: "Equipación temporada — 120 camisetas",
      notes: "Prendas aportadas por el club. Muestra de color antes de tirada.",
      ...totalsFor(textilLines, 500),
      lines: {
        create: textilLines.map((line) => ({
          ...line,
          sku: "SER-PAN-4T",
          itemId: itemId("SER-PAN-4T"),
        })),
      },
    },
  });

  // Presupuesto en borrador, todavía sin numerar.
  const escaparateLines = buildLines([
    {
      description: "Vinilo microperforado — escaparate principal 3,2 × 2,1 m",
      unit: "m2",
      quantity: 6.72,
      unitPrice: eur(34),
    },
    {
      description: "Vinilo de corte — horarios y logotipo en puerta de acceso",
      unit: "m2",
      quantity: 0.8,
      unitPrice: eur(22),
    },
  ]);

  await prisma.quote.create({
    data: {
      series: "A",
      year,
      customerId: customerId("C-0003"),
      createdById: admin.id,
      status: "DRAFT",
      issueDate: new Date(),
      validUntil: daysFromNow(30),
      title: "Escaparate y puerta",
      internalNotes: "Falta medir la puerta. Marta pasa las medidas el viernes.",
      ...totalsFor(escaparateLines),
      lines: {
        create: escaparateLines.map((line) => ({
          ...line,
          sku: "VIN-MIC-M2",
          itemId: itemId("VIN-MIC-M2"),
        })),
      },
    },
  });

  // Pedido pequeño y directo, sin presupuesto previo, listo para recoger.
  const lonaLines = buildLines([
    {
      description: "Lona banner con ojales — 3 × 1 m, texto de apertura",
      unit: "m2",
      quantity: 3,
      unitPrice: eur(19),
    },
  ]);

  await prisma.order.create({
    data: {
      number: `PED-A-${year}-0002`,
      series: "A",
      year,
      customerId: customerId("C-0004"),
      createdById: admin.id,
      status: "READY",
      orderDate: daysFromNow(-3),
      dueDate: daysFromNow(-1),
      title: "Lona 3 × 1 m",
      notes: "Recoge en tienda.",
      ...totalsFor(lonaLines),
      lines: {
        create: lonaLines.map((line) => ({
          ...line,
          sku: "LON-BAN-M2",
          itemId: itemId("LON-BAN-M2"),
        })),
      },
    },
  });

  await prisma.numberSequence.createMany({
    data: [
      { docType: "QUOTE", series: "A", year, next: 3 },
      { docType: "ORDER", series: "A", year, next: 3 },
    ],
  });

  // --- Grupos de newsletter de ejemplo -------------------------------------

  await prisma.segment.create({
    data: {
      name: "Clientes de textil",
      description: "Para avisar de novedades en serigrafía sobre prenda.",
      kind: "DYNAMIC",
      createdById: admin.id,
      rulesJson: JSON.stringify({
        kinds: [],
        tagsAny: ["textil"],
        provinces: [],
        onlyActive: true,
        orderedSinceMonths: null,
        minSpentCents: null,
      }),
    },
  });

  const recurrentes = await prisma.segment.create({
    data: {
      name: "Recurrentes de rotulación",
      description: "Lista corta para el aviso de revisión anual de vinilos.",
      kind: "STATIC",
      createdById: admin.id,
      includeAllContacts: true,
    },
  });
  await prisma.segmentMember.create({
    data: { segmentId: recurrentes.id, customerId: customerId("C-0001") },
  });

  console.log("\nBase de datos preparada.\n");
  console.log(`  Usuario:    ${email}`);
  console.log(`  Contraseña: ${password}`);
  console.log("\nCámbiala al entrar desde Ajustes.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
