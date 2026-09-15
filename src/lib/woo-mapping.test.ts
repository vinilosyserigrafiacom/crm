import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deduceVatRate,
  extractTaxId,
  mapCustomer,
  mapCustomerFromOrder,
  mapLines,
  mapOrder,
  mapWooStatus,
  provinceName,
  wooAmountToCents,
} from "./woo-mapping";
import { wooCustomerSchema, wooOrderSchema } from "./woocommerce";

/*
 * Lo que se prueba aquí es la traducción de la tienda al CRM. Un error en esta
 * parte no se ve: importa un pedido con el IVA mal deducido o el importe a
 * cero, y nadie se entera hasta que no cuadra la caja.
 *
 * Los datos de entrada se pasan por el esquema de Zod a propósito, para que las
 * pruebas usen exactamente la misma forma que llega de la tienda de verdad.
 */

const pedidoDeWoo = (overrides: Record<string, unknown> = {}) =>
  wooOrderSchema.parse({
    id: 1234,
    number: "1234",
    status: "processing",
    currency: "EUR",
    date_created_gmt: "2026-09-10T08:30:00",
    customer_id: 7,
    total: "121.00",
    total_tax: "21.00",
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
    ...overrides,
  });

describe("wooAmountToCents", () => {
  it("convierte el formato de la tienda", () => {
    assert.equal(wooAmountToCents("121.00"), 12_100);
    assert.equal(wooAmountToCents("0.05"), 5);
    assert.equal(wooAmountToCents("28"), 2_800);
    assert.equal(wooAmountToCents("-10.50"), -1_050);
  });

  it("trata lo vacío o lo raro como cero, sin adivinar", () => {
    assert.equal(wooAmountToCents(""), 0);
    assert.equal(wooAmountToCents(null), 0);
    assert.equal(wooAmountToCents("1.234,56"), 0);
    assert.equal(wooAmountToCents("a consultar"), 0);
  });

  it("no pierde céntimos con decimales largos", () => {
    // WooCommerce puede mandar más de dos decimales según los ajustes.
    assert.equal(wooAmountToCents("33.333"), 3_333);
  });
});

describe("deduceVatRate", () => {
  it("deduce los tipos españoles de los importes", () => {
    assert.equal(deduceVatRate(10_000, 2_100), 2100);
    assert.equal(deduceVatRate(10_000, 1_000), 1000);
    assert.equal(deduceVatRate(10_000, 400), 400);
    assert.equal(deduceVatRate(10_000, 0), 0);
  });

  it("ajusta el redondeo al tipo legal más cercano", () => {
    // 20,99% no es un tipo que exista: es 21% con el redondeo de la tienda.
    assert.equal(deduceVatRate(3_333, 700), 2100);
    assert.equal(deduceVatRate(777, 163), 2100);
  });

  it("respeta un tipo que no sea español", () => {
    // 19% (Alemania) no se fuerza al 21%.
    assert.equal(deduceVatRate(10_000, 1_900), 1900);
  });

  it("una línea a cero no inventa IVA", () => {
    assert.equal(deduceVatRate(0, 0), 0);
  });
});

describe("mapWooStatus", () => {
  it("traduce los estados de la tienda", () => {
    assert.equal(mapWooStatus("processing"), "CONFIRMED");
    assert.equal(mapWooStatus("completed"), "DELIVERED");
    assert.equal(mapWooStatus("pending"), "DRAFT");
    assert.equal(mapWooStatus("on-hold"), "DRAFT");
    assert.equal(mapWooStatus("cancelled"), "CANCELLED");
    assert.equal(mapWooStatus("refunded"), "CANCELLED");
  });

  it("un estado desconocido entra como borrador, no se pierde", () => {
    // Los plugins añaden estados propios: "wc-preparando", por ejemplo.
    assert.equal(mapWooStatus("preparando-envio"), "DRAFT");
    assert.equal(mapWooStatus("PROCESSING"), "CONFIRMED");
  });
});

describe("provinceName", () => {
  it("traduce el código a nombre para que los filtros funcionen", () => {
    assert.equal(provinceName("VA", "ES"), "Valladolid");
    assert.equal(provinceName("bi", "ES"), "Vizcaya");
  });

  it("deja el texto tal cual si no es España o no reconoce el código", () => {
    assert.equal(provinceName("Lisboa", "PT"), "Lisboa");
    assert.equal(provinceName("XX", "ES"), "XX");
    assert.equal(provinceName("", "ES"), null);
  });
});

describe("extractTaxId", () => {
  it("encuentra el NIF en las claves que usan los plugins", () => {
    assert.equal(extractTaxId([{ key: "_billing_nif", value: "b47286158" }]), "B47286158");
    assert.equal(extractTaxId([{ key: "billing_vat_number", value: "X1234567L" }]), "X1234567L");
  });

  it("no se inventa nada si no está", () => {
    assert.equal(extractTaxId([]), null);
    assert.equal(extractTaxId([{ key: "otra_cosa", value: "B47286158" }]), null);
    assert.equal(extractTaxId([{ key: "_billing_nif", value: "  " }]), null);
    assert.equal(extractTaxId([{ key: "_billing_nif", value: 12345 }]), null);
  });
});

describe("mapCustomer", () => {
  const base = {
    id: 7,
    email: "nuria@arribas.example",
    first_name: "Nuria",
    last_name: "Arribas",
    billing: {
      company: "Talleres Arribas S.L.",
      address_1: "Calle Plata 14",
      city: "Valladolid",
      state: "VA",
      postcode: "47012",
      country: "ES",
      phone: "620112233",
    },
    meta_data: [{ key: "_billing_nif", value: "B47286158" }],
  };

  it("una empresa entra como empresa, y la persona como contacto", () => {
    const mapped = mapCustomer(wooCustomerSchema.parse(base));
    assert.equal(mapped.kind, "COMPANY");
    assert.equal(mapped.legalName, "Talleres Arribas S.L.");
    assert.equal(mapped.contactName, "Nuria Arribas");
    assert.equal(mapped.taxId, "B47286158");
    assert.equal(mapped.addresses[0].province, "Valladolid");
  });

  it("sin empresa, el cliente es un particular y no hay contacto aparte", () => {
    const mapped = mapCustomer(
      wooCustomerSchema.parse({ ...base, billing: { ...base.billing, company: "" } }),
    );
    assert.equal(mapped.kind, "INDIVIDUAL");
    assert.equal(mapped.legalName, "Nuria Arribas");
    assert.equal(mapped.contactName, null);
  });

  it("sin nombre ninguno, se apaña con el correo antes que quedarse en blanco", () => {
    const mapped = mapCustomer(
      wooCustomerSchema.parse({ id: 9, email: "alguien@example.com" }),
    );
    assert.equal(mapped.legalName, "alguien@example.com");
  });

  it("no duplica la dirección de envío si es la misma que la de facturación", () => {
    const mapped = mapCustomer(
      wooCustomerSchema.parse({
        ...base,
        shipping: { address_1: "Calle Plata 14", city: "Valladolid", country: "ES" },
      }),
    );
    assert.equal(mapped.addresses.length, 1);
  });

  it("sí guarda la de envío cuando es distinta", () => {
    const mapped = mapCustomer(
      wooCustomerSchema.parse({
        ...base,
        shipping: { address_1: "Nave 3, Polígono San Cristóbal", city: "Valladolid", country: "ES" },
      }),
    );
    assert.deepEqual(
      mapped.addresses.map((a) => a.kind),
      ["BILLING", "SHIPPING"],
    );
  });
});

describe("mapLines", () => {
  it("deduce precio unitario, descuento e IVA de cada línea", () => {
    const [linea] = mapLines(pedidoDeWoo());
    assert.equal(linea.quantity, 2);
    assert.equal(linea.unitPrice, 5_000);
    assert.equal(linea.grossAmount, 10_000);
    assert.equal(linea.discountRate, 0);
    assert.equal(linea.netAmount, 10_000);
    assert.equal(linea.vatRate, 2100);
    assert.equal(linea.sku, "VIN-IMP-M2");
  });

  it("deduce el descuento de la diferencia entre subtotal y total", () => {
    const [linea] = mapLines(
      pedidoDeWoo({
        line_items: [
          {
            name: "Vinilo",
            quantity: 1,
            subtotal: "100.00",
            total: "90.00",
            total_tax: "18.90",
          },
        ],
      }),
    );
    assert.equal(linea.unitPrice, 10_000);
    assert.equal(linea.discountAmount, 1_000);
    assert.equal(linea.discountRate, 1000); // 10%
    assert.equal(linea.netAmount, 9_000);
    assert.equal(linea.vatRate, 2100);
  });

  it("los portes entran como una línea más", () => {
    const lineas = mapLines(
      pedidoDeWoo({
        shipping_lines: [{ method_title: "Envío estándar", total: "5.00", total_tax: "1.05" }],
      }),
    );
    assert.equal(lineas.length, 2);
    assert.equal(lineas[1].description, "Envío estándar");
    assert.equal(lineas[1].netAmount, 500);
    assert.equal(lineas[1].vatRate, 2100);
  });

  it("los portes gratis no ensucian el documento", () => {
    const lineas = mapLines(
      pedidoDeWoo({ shipping_lines: [{ method_title: "Recogida", total: "0.00" }] }),
    );
    assert.equal(lineas.length, 1);
  });

  it("una línea sin nombre no se queda en blanco", () => {
    const [linea] = mapLines(
      pedidoDeWoo({ line_items: [{ quantity: 1, subtotal: "10.00", total: "10.00" }] }),
    );
    assert.equal(linea.description, "Artículo de la tienda");
  });
});

describe("mapOrder", () => {
  it("recalcula los totales con el motor del CRM", () => {
    const mapped = mapOrder(pedidoDeWoo());
    assert.equal(mapped.totals.taxableBase, 10_000);
    assert.equal(mapped.totals.vatTotal, 2_100);
    assert.equal(mapped.totals.total, 12_100);
    // Y coincide con lo que dice la tienda, que es lo que se contrasta.
    assert.equal(mapped.wooTotalCents, 12_100);
  });

  it("conserva el número de la tienda para no gastar serie del CRM", () => {
    const mapped = mapOrder(pedidoDeWoo({ number: "VYS-1042" }));
    assert.equal(mapped.wooNumber, "VYS-1042");
    assert.equal(mapped.customerRef, "VYS-1042");
  });

  it("sin número usa el id, para no quedarse sin referencia", () => {
    const mapped = mapOrder(pedidoDeWoo({ number: "" }));
    assert.equal(mapped.wooNumber, "1234");
  });

  it("resume el trabajo con el primer concepto", () => {
    const mapped = mapOrder(
      pedidoDeWoo({
        line_items: [
          { name: "Vinilo impreso", quantity: 1, subtotal: "10.00", total: "10.00" },
          { name: "Instalación", quantity: 1, subtotal: "35.00", total: "35.00" },
        ],
      }),
    );
    assert.equal(mapped.title, "Vinilo impreso y 1 concepto más");
  });

  it("una fecha inválida no rompe la importación", () => {
    const mapped = mapOrder(pedidoDeWoo({ date_created_gmt: "no es una fecha" }));
    assert.ok(mapped.orderDate instanceof Date);
    assert.ok(!Number.isNaN(mapped.orderDate.getTime()));
  });

  it("un pedido sin líneas no revienta y queda a cero", () => {
    const mapped = mapOrder(pedidoDeWoo({ line_items: [], total: "0.00" }));
    assert.equal(mapped.lines.length, 0);
    assert.equal(mapped.totals.total, 0);
    assert.equal(mapped.title, null);
  });
});

describe("mapCustomerFromOrder", () => {
  it("saca el cliente de un pedido de invitado", () => {
    const mapped = mapCustomerFromOrder(pedidoDeWoo({ customer_id: 0 }));
    assert.equal(mapped.legalName, "Talleres Arribas S.L.");
    assert.equal(mapped.email, "nuria@arribas.example");
    assert.equal(mapped.addresses[0].city, "Valladolid");
  });

  it("un invitado sin nombre ni empresa se identifica por el pedido", () => {
    const mapped = mapCustomerFromOrder(
      pedidoDeWoo({ customer_id: 0, number: "555", billing: {} }),
    );
    assert.equal(mapped.legalName, "Pedido 555");
  });
});
