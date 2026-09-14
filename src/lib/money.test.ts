import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRate,
  centsToInput,
  computeDocumentTotals,
  computeLine,
  formatQuantity,
  formatRate,
  marginBasisPoints,
  parseAmountToCents,
  parseQuantity,
  parseRateToBasisPoints,
  parseVatBreakdown,
  roundCents,
} from "./money";

/*
 * El cálculo de importes es lo único de este proyecto que, si falla, produce un
 * documento con valor legal equivocado. De ahí que sea la parte con pruebas.
 */

describe("roundCents", () => {
  it("redondea al céntimo más cercano", () => {
    assert.equal(roundCents(10.4), 10);
    assert.equal(roundCents(10.5), 11);
    assert.equal(roundCents(10.6), 11);
  });

  it("redondea igual en negativo, alejándose del cero", () => {
    assert.equal(roundCents(-10.5), -11);
    assert.equal(roundCents(-10.4), -10);
  });
});

describe("computeLine", () => {
  it("calcula bruto, descuento y neto", () => {
    const line = computeLine({ quantity: 3, unitPrice: 1000, discountRate: 1000 });
    assert.deepEqual(line, { grossAmount: 3000, discountAmount: 300, netAmount: 2700 });
  });

  it("redondea cantidades con decimales, como los metros cuadrados", () => {
    // 6,72 m2 a 34,00 € = 228,48 €
    const line = computeLine({ quantity: 6.72, unitPrice: 3400 });
    assert.equal(line.netAmount, 22848);
  });

  it("no pierde céntimos con precios que no son redondos", () => {
    // 7 unidades a 3,33 € = 23,31 €
    const line = computeLine({ quantity: 7, unitPrice: 333 });
    assert.equal(line.grossAmount, 2331);
  });
});

describe("computeDocumentTotals", () => {
  it("agrupa el IVA por tipo y suma las cuotas", () => {
    const totals = computeDocumentTotals({
      lines: [
        { quantity: 1, unitPrice: 10_000, vatRate: 2100 },
        { quantity: 1, unitPrice: 5_000, vatRate: 2100 },
        { quantity: 1, unitPrice: 3_000, vatRate: 1000 },
      ],
    });

    assert.equal(totals.linesSubtotal, 18_000);
    assert.equal(totals.taxableBase, 18_000);
    assert.deepEqual(totals.vatBreakdown, [
      { rate: 1000, base: 3_000, vat: 300 },
      { rate: 2100, base: 15_000, vat: 3_150 },
    ]);
    assert.equal(totals.vatTotal, 3_450);
    assert.equal(totals.total, 21_450);
  });

  it("calcula el IVA sobre el grupo, no línea a línea", () => {
    // Tres líneas de 0,05 € al 21%: línea a línea el IVA sería 3 × 1 céntimo
    // (0,0105 redondeado a 1) = 3 céntimos. Sobre el grupo, 0,15 × 21% =
    // 0,0315, que redondea a 3 céntimos. Con siete líneas la diferencia se ve:
    // 7 × 1 = 7 céntimos frente a 0,35 × 21% = 0,0735 -> 7 céntimos.
    const lines = Array.from({ length: 7 }, () => ({
      quantity: 1,
      unitPrice: 5,
      vatRate: 2100,
    }));
    const totals = computeDocumentTotals({ lines });

    assert.equal(totals.taxableBase, 35);
    assert.equal(totals.vatTotal, 7);
    assert.equal(totals.total, 42);
  });

  it("reparte el descuento global sin perder ni ganar céntimos", () => {
    const totals = computeDocumentTotals({
      lines: [
        { quantity: 1, unitPrice: 3_333, vatRate: 2100 },
        { quantity: 1, unitPrice: 3_333, vatRate: 1000 },
        { quantity: 1, unitPrice: 3_334, vatRate: 400 },
      ],
      // 7% sobre 99,99 € = 6,9993 € -> 7,00 €, que no divide exacto entre tres.
      globalDiscountRate: 700,
    });

    const sumOfBases = totals.vatBreakdown.reduce((sum, entry) => sum + entry.base, 0);
    assert.equal(totals.discountTotal, 700);
    assert.equal(sumOfBases, totals.linesSubtotal - totals.discountTotal);
    assert.equal(totals.taxableBase, 9_300);
  });

  it("mantiene la cuadratura con descuentos que no dividen exacto", () => {
    // Cualquier combinación debe cumplir: base = subtotal - descuento, y el
    // total = base + IVA - retención. Se comprueba sobre una batería de casos
    // en lugar de sobre uno solo, que es donde se esconden los descuadres.
    const rates = [0, 400, 1000, 2100];
    for (let seed = 1; seed <= 60; seed += 1) {
      const lines = Array.from({ length: (seed % 5) + 1 }, (_, i) => ({
        quantity: ((seed * (i + 3)) % 17) + 0.25,
        unitPrice: (seed * 137 + i * 991) % 9_999,
        discountRate: (seed * i * 13) % 2_500,
        vatRate: rates[(seed + i) % rates.length],
      }));
      const globalDiscountRate = (seed * 37) % 1_500;
      const withholdingRate = seed % 3 === 0 ? 1_500 : 0;

      const totals = computeDocumentTotals({ lines, globalDiscountRate, withholdingRate });
      const sumOfBases = totals.vatBreakdown.reduce((sum, entry) => sum + entry.base, 0);
      const sumOfVat = totals.vatBreakdown.reduce((sum, entry) => sum + entry.vat, 0);

      assert.equal(
        totals.taxableBase,
        totals.linesSubtotal - totals.discountTotal,
        `la base no cuadra en el caso ${seed}`,
      );
      assert.equal(sumOfBases, totals.taxableBase, `el desglose no suma en el caso ${seed}`);
      assert.equal(sumOfVat, totals.vatTotal, `las cuotas no suman en el caso ${seed}`);
      assert.equal(
        totals.total,
        totals.taxableBase + totals.vatTotal - totals.withholdingTotal,
        `el total no cuadra en el caso ${seed}`,
      );
    }
  });

  it("resta la retención de IRPF del total, no de la base", () => {
    const totals = computeDocumentTotals({
      lines: [{ quantity: 1, unitPrice: 100_000, vatRate: 2100 }],
      withholdingRate: 1_500,
    });

    assert.equal(totals.taxableBase, 100_000);
    assert.equal(totals.vatTotal, 21_000);
    assert.equal(totals.withholdingTotal, 15_000);
    assert.equal(totals.total, 106_000);
  });

  it("devuelve todo a cero sin líneas", () => {
    const totals = computeDocumentTotals({ lines: [] });
    assert.equal(totals.total, 0);
    assert.deepEqual(totals.vatBreakdown, []);
  });

  it("no cobra IVA a un cliente exento", () => {
    const totals = computeDocumentTotals({
      lines: [{ quantity: 2, unitPrice: 50_000, vatRate: 0 }],
    });
    assert.equal(totals.vatTotal, 0);
    assert.equal(totals.total, 100_000);
  });
});

describe("applyRate", () => {
  it("aplica puntos base sobre céntimos", () => {
    assert.equal(applyRate(10_000, 2100), 2_100);
    assert.equal(applyRate(333, 2100), 70); // 69,93 -> 70
  });
});

describe("parseAmountToCents", () => {
  it("lee el formato español con coma decimal", () => {
    assert.equal(parseAmountToCents("1.234,56"), 123_456);
    assert.equal(parseAmountToCents("0,05"), 5);
    assert.equal(parseAmountToCents("28"), 2_800);
  });

  it("lee también el formato con punto decimal", () => {
    assert.equal(parseAmountToCents("1234.56"), 123_456);
    assert.equal(parseAmountToCents("1,234.56"), 123_456);
  });

  it("tolera el símbolo de euro y los espacios", () => {
    assert.equal(parseAmountToCents(" 1.234,56 € "), 123_456);
    assert.equal(parseAmountToCents("1 234,56"), 123_456);
  });

  it("devuelve null con texto que no es un número", () => {
    assert.equal(parseAmountToCents(""), null);
    assert.equal(parseAmountToCents("a consultar"), null);
    assert.equal(parseAmountToCents("12,3,4"), null);
  });
});

describe("parseRateToBasisPoints", () => {
  it("convierte porcentajes a puntos base", () => {
    assert.equal(parseRateToBasisPoints("21"), 2100);
    assert.equal(parseRateToBasisPoints("21%"), 2100);
    assert.equal(parseRateToBasisPoints("0,5"), 50);
    assert.equal(parseRateToBasisPoints(""), null);
  });
});

describe("parseQuantity", () => {
  it("redondea a tres decimales y rechaza negativos", () => {
    assert.equal(parseQuantity("6,72"), 6.72);
    // Tres decimales es la precisión del taller: 1,2345 se redondea, no se corta.
    assert.equal(parseQuantity("1,2345"), 1.235);
    assert.equal(parseQuantity("-3"), null);
    assert.equal(parseQuantity("dos"), null);
  });
});

describe("formato", () => {
  it("presenta los porcentajes con coma", () => {
    assert.equal(formatRate(2100), "21%");
    assert.equal(formatRate(50), "0,5%");
  });

  it("presenta las cantidades sin ceros sobrantes", () => {
    assert.equal(formatQuantity(2.5), "2,5");
    assert.equal(formatQuantity(12), "12");
  });

  it("vuelca céntimos a un input editable", () => {
    assert.equal(centsToInput(123_456), "1234,56");
    assert.equal(centsToInput(0), "0,00");
  });
});

describe("marginBasisPoints", () => {
  it("calcula el margen sobre el precio de venta", () => {
    assert.equal(marginBasisPoints(2_800, 1_150), 5_893);
  });

  it("devuelve null cuando no hay venta", () => {
    assert.equal(marginBasisPoints(0, 100), null);
  });
});

describe("parseVatBreakdown", () => {
  it("lee el desglose guardado", () => {
    assert.deepEqual(parseVatBreakdown('[{"rate":2100,"base":1000,"vat":210}]'), [
      { rate: 2100, base: 1000, vat: 210 },
    ]);
  });

  it("aguanta un JSON roto sin reventar la página", () => {
    assert.deepEqual(parseVatBreakdown("{no es json"), []);
    assert.deepEqual(parseVatBreakdown(null), []);
    assert.deepEqual(parseVatBreakdown('[{"rate":"x"}]'), []);
  });
});
