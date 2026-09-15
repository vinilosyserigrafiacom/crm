import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_RULES,
  buildCustomerWhere,
  describeRules,
  parseRules,
  recipientsForCustomer,
  toCsv,
  type AudienceCustomer,
  type Recipient,
} from "./segments";

/*
 * Lo que se prueba aquí es quién acaba recibiendo un correo comercial. Un fallo
 * en esta parte no rompe una pantalla: escribe a quien pidió que no le
 * escribieran, que es un problema con el cliente y con la ley.
 */

const AYER = new Date("2026-09-14T10:00:00Z");

function cliente(overrides: Partial<AudienceCustomer> = {}): AudienceCustomer {
  return {
    id: "c1",
    code: "C-0001",
    legalName: "Talleres Arribas S.L.",
    tradeName: null,
    email: "info@arribas.example",
    marketingOptOut: false,
    marketingConsentAt: AYER,
    contacts: [],
    ...overrides,
  };
}

function contacto(overrides: Partial<AudienceCustomer["contacts"][number]> = {}) {
  return {
    name: "Nuria Arribas",
    email: "nuria@arribas.example",
    isPrimary: true,
    marketingOptOut: false,
    marketingConsentAt: AYER,
    ...overrides,
  };
}

const SOLO_PRINCIPAL = { onlyWithConsent: true, includeAllContacts: false };

describe("recipientsForCustomer · bajas", () => {
  it("la baja del cliente deja fuera también a sus contactos", () => {
    const resultado = recipientsForCustomer(
      cliente({ marketingOptOut: true, contacts: [contacto()] }),
      SOLO_PRINCIPAL,
    );
    assert.deepEqual(resultado.recipients, []);
    assert.equal(resultado.excludedReason, "BAJA");
  });

  it("un contacto de baja no recibe, aunque el cliente sí quiera", () => {
    const resultado = recipientsForCustomer(
      cliente({ email: null, contacts: [contacto({ marketingOptOut: true })] }),
      SOLO_PRINCIPAL,
    );
    assert.deepEqual(resultado.recipients, []);
    assert.equal(resultado.excludedReason, "BAJA");
  });

  it("distingue no tener correo de haberse dado de baja", () => {
    const resultado = recipientsForCustomer(
      cliente({ email: null, contacts: [] }),
      SOLO_PRINCIPAL,
    );
    assert.equal(resultado.excludedReason, "SIN_CORREO");
  });
});

describe("recipientsForCustomer · consentimiento", () => {
  it("exige consentimiento expreso cuando el grupo lo pide", () => {
    const resultado = recipientsForCustomer(
      cliente({ marketingConsentAt: null, contacts: [] }),
      SOLO_PRINCIPAL,
    );
    assert.deepEqual(resultado.recipients, []);
    assert.equal(resultado.excludedReason, "SIN_CONSENTIMIENTO");
  });

  it("sin exigirlo, basta con no estar de baja", () => {
    const resultado = recipientsForCustomer(cliente({ marketingConsentAt: null, contacts: [] }), {
      onlyWithConsent: false,
      includeAllContacts: false,
    });
    assert.equal(resultado.recipients.length, 1);
    assert.equal(resultado.recipients[0].email, "info@arribas.example");
    assert.equal(resultado.recipients[0].consentAt, null);
  });

  it("deja pasar solo a los contactos que sí consintieron", () => {
    const resultado = recipientsForCustomer(
      cliente({
        email: null,
        contacts: [
          contacto({ name: "Con", email: "con@x.example" }),
          contacto({
            name: "Sin",
            email: "sin@x.example",
            isPrimary: false,
            marketingConsentAt: null,
          }),
        ],
      }),
      { onlyWithConsent: true, includeAllContacts: true },
    );
    assert.deepEqual(
      resultado.recipients.map((r) => r.email),
      ["con@x.example"],
    );
  });
});

describe("recipientsForCustomer · a quién se escribe", () => {
  it("por defecto solo al contacto principal", () => {
    const resultado = recipientsForCustomer(
      cliente({
        contacts: [
          contacto({ name: "Principal", email: "principal@x.example", isPrimary: true }),
          contacto({ name: "Otro", email: "otro@x.example", isPrimary: false }),
        ],
      }),
      SOLO_PRINCIPAL,
    );
    assert.deepEqual(
      resultado.recipients.map((r) => r.email),
      ["principal@x.example"],
    );
  });

  it("con todos los contactos, entran también ellos y el correo de la ficha", () => {
    const resultado = recipientsForCustomer(
      cliente({
        contacts: [
          contacto({ name: "Principal", email: "principal@x.example", isPrimary: true }),
          contacto({ name: "Otro", email: "otro@x.example", isPrimary: false }),
        ],
      }),
      { onlyWithConsent: true, includeAllContacts: true },
    );
    assert.deepEqual(resultado.recipients.map((r) => r.email).sort(), [
      "info@arribas.example",
      "otro@x.example",
      "principal@x.example",
    ]);
  });

  it("si no hay contacto principal, usa el correo del cliente", () => {
    const resultado = recipientsForCustomer(
      cliente({ contacts: [contacto({ isPrimary: false })] }),
      SOLO_PRINCIPAL,
    );
    assert.deepEqual(
      resultado.recipients.map((r) => r.source),
      ["CUSTOMER"],
    );
  });

  it("ignora los correos en blanco", () => {
    const resultado = recipientsForCustomer(
      cliente({ email: "   ", contacts: [contacto({ email: "  " })] }),
      SOLO_PRINCIPAL,
    );
    assert.equal(resultado.excludedReason, "SIN_CORREO");
  });

  it("usa el nombre comercial cuando lo hay", () => {
    const resultado = recipientsForCustomer(
      cliente({ tradeName: "Talleres Arribas", contacts: [] }),
      SOLO_PRINCIPAL,
    );
    assert.equal(resultado.recipients[0].customerName, "Talleres Arribas");
  });
});

describe("parseRules", () => {
  it("rellena lo que falte con los valores por defecto", () => {
    assert.deepEqual(parseRules('{"tagsAny":["textil"]}'), {
      ...EMPTY_RULES,
      tagsAny: ["textil"],
    });
  });

  it("aguanta un JSON roto o unas reglas inválidas", () => {
    assert.deepEqual(parseRules("{no es json"), EMPTY_RULES);
    assert.deepEqual(parseRules('{"orderedSinceMonths":999}'), EMPTY_RULES);
    assert.deepEqual(parseRules(null), EMPTY_RULES);
  });
});

describe("buildCustomerWhere", () => {
  it("sin reglas, solo pide que el cliente esté activo", () => {
    assert.deepEqual(buildCustomerWhere(EMPTY_RULES), { active: true });
  });

  it("las etiquetas se buscan con OR", () => {
    const where = buildCustomerWhere({ ...EMPTY_RULES, tagsAny: ["textil", "vinilo"] });
    assert.deepEqual(where.OR, [
      { tags: { contains: "textil" } },
      { tags: { contains: "vinilo" } },
    ]);
  });

  it("el filtro por actividad mira los pedidos no anulados", () => {
    const where = buildCustomerWhere({ ...EMPTY_RULES, orderedSinceMonths: 6 });
    assert.ok(where.orders, "debería filtrar por pedidos");
  });
});

describe("describeRules", () => {
  it("resume en castellano", () => {
    assert.equal(
      describeRules({ ...EMPTY_RULES, kinds: ["COMPANY"], tagsAny: ["textil"] }),
      "Clientes empresas, etiquetados como textil",
    );
  });

  it("sin reglas lo dice claramente", () => {
    assert.equal(describeRules(EMPTY_RULES), "Todos los clientes activos");
  });
});

describe("toCsv", () => {
  const base: Recipient = {
    email: "nuria@arribas.example",
    name: "Nuria Arribas",
    customerId: "c1",
    customerCode: "C-0001",
    customerName: "Talleres Arribas",
    source: "CONTACT",
    consentAt: AYER,
  };

  it("escribe la cabecera y una fila por destinatario", () => {
    const lineas = toCsv([base]).split("\r\n");
    assert.equal(lineas[0], "﻿email,nombre,cliente,codigo_cliente,origen,consentimiento");
    assert.equal(
      lineas[1],
      "nuria@arribas.example,Nuria Arribas,Talleres Arribas,C-0001,contacto,2026-09-14",
    );
  });

  it("entrecomilla lo que lleva comas o comillas", () => {
    const csv = toCsv([{ ...base, customerName: 'Arribas, S.L. "el taller"' }]);
    assert.ok(csv.includes('"Arribas, S.L. ""el taller"""'), csv);
  });

  it("neutraliza las fórmulas para que Excel no las ejecute", () => {
    const csv = toCsv([{ ...base, name: '=HYPERLINK("http://malo","pincha")' }]);
    // Antepone un apóstrofo, y como además lleva comas queda entrecomillado.
    assert.ok(csv.includes(`"'=HYPERLINK(`), csv);
    assert.ok(!csv.includes(",=HYPERLINK"), "la fórmula ha quedado sin neutralizar");
  });

  it("una lista vacía deja solo la cabecera", () => {
    assert.equal(toCsv([]).split("\r\n").filter(Boolean).length, 1);
  });
});
