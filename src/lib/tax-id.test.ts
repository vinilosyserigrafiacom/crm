import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTaxId, normalizeTaxId, taxIdWarning } from "./tax-id";

describe("normalizeTaxId", () => {
  it("quita espacios, guiones y puntos, y pasa a mayúsculas", () => {
    assert.equal(normalizeTaxId(" b-47.286 158 "), "B47286158");
  });
});

describe("checkTaxId", () => {
  it("valida un NIF de persona física", () => {
    assert.deepEqual(checkTaxId("12345678Z"), {
      kind: "NIF",
      valid: true,
      normalized: "12345678Z",
    });
    assert.equal(checkTaxId("12345678A").valid, false);
  });

  it("valida un NIE", () => {
    assert.equal(checkTaxId("X1234567L").valid, true);
    assert.equal(checkTaxId("X1234567M").valid, false);
  });

  it("valida un CIF de entidad", () => {
    assert.equal(checkTaxId("B47286158").valid, true);
    // Los CIF de asociaciones llevan letra de control en lugar de dígito.
    assert.equal(checkTaxId("G47512348").kind, "CIF");
    assert.equal(checkTaxId("B47286150").valid, false);
  });

  it("marca como desconocido lo que no tiene forma de NIF, NIE ni CIF", () => {
    assert.equal(checkTaxId("DE123456789").kind, "UNKNOWN");
    assert.equal(checkTaxId("").kind, "UNKNOWN");
  });
});

describe("taxIdWarning", () => {
  it("no avisa de nada si el identificador está bien", () => {
    assert.equal(taxIdWarning("B47286158"), null);
  });

  it("avisa si el dígito de control no cuadra", () => {
    assert.match(taxIdWarning("12345678A") ?? "", /control/);
  });

  it("no avisa si el campo está vacío: el NIF no es obligatorio", () => {
    assert.equal(taxIdWarning(""), null);
    assert.equal(taxIdWarning("   "), null);
  });

  it("no aplica las reglas españolas a clientes de otro país", () => {
    assert.equal(taxIdWarning("DE123456789", "DE"), null);
  });
});
