import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decryptJson, encryptJson, maskSecret } from "./secrets";

/**
 * El cifrado de las credenciales.
 *
 * Lo que se comprueba aquí no es que AES funcione —de eso ya responde Node—
 * sino lo que hace este módulo alrededor: que nada quede legible, que un texto
 * manipulado no cuele y que cambiar SESSION_SECRET no reviente la pantalla,
 * solo devuelva null para que se pidan las claves otra vez.
 */

const SECRETO = "una-clave-de-sesion-larga-y-aleatoria-1234567890";

function conSecreto<T>(secreto: string, fn: () => T): T {
  const anterior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secreto;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = anterior;
  }
}

describe("encryptJson / decryptJson", () => {
  test("lo cifrado vuelve igual", () => {
    const datos = { baseUrl: "https://tienda.example", consumerKey: "ck_1", consumerSecret: "cs_2" };
    const vuelta = conSecreto(SECRETO, () => decryptJson(encryptJson(datos)));
    assert.deepEqual(vuelta, datos);
  });

  test("la clave no aparece en claro en lo guardado", () => {
    const cifrado = conSecreto(SECRETO, () =>
      encryptJson({ consumerSecret: "cs_supersecreto_9999" }),
    );
    assert.ok(!cifrado.includes("cs_supersecreto_9999"));
    assert.ok(!Buffer.from(cifrado, "utf8").toString("latin1").includes("supersecreto"));
  });

  test("dos cifrados del mismo dato no son iguales", () => {
    // Cada uno lleva su propio vector de inicialización: si salieran idénticos,
    // quien viera la base de datos sabría que dos integraciones comparten clave.
    const [a, b] = conSecreto(SECRETO, () => [
      encryptJson({ apiKey: "misma" }),
      encryptJson({ apiKey: "misma" }),
    ]);
    assert.notEqual(a, b);
  });

  test("un texto manipulado no cuela", () => {
    const cifrado = conSecreto(SECRETO, () => encryptJson({ apiKey: "original" }));
    const partes = cifrado.split(".");
    // Se cambia un carácter del contenido: la etiqueta de autenticación falla.
    const datos = Buffer.from(partes[3], "base64");
    datos[0] = datos[0] ^ 0xff;
    partes[3] = datos.toString("base64");

    const vuelta = conSecreto(SECRETO, () => decryptJson(partes.join(".")));
    assert.equal(vuelta, null);
  });

  test("con otro SESSION_SECRET devuelve null en vez de reventar", () => {
    const cifrado = conSecreto(SECRETO, () => encryptJson({ apiKey: "original" }));
    const vuelta = conSecreto("otro-secreto-completamente-distinto-0987654321", () =>
      decryptJson(cifrado),
    );
    assert.equal(vuelta, null);
  });

  test("un formato que no reconoce devuelve null", () => {
    conSecreto(SECRETO, () => {
      assert.equal(decryptJson(""), null);
      assert.equal(decryptJson("basura"), null);
      assert.equal(decryptJson("v2.a.b.c"), null);
    });
  });

  test("sin SESSION_SECRET utilizable, avisa en vez de cifrar con nada", () => {
    assert.throws(
      () => conSecreto("corto", () => encryptJson({ apiKey: "x" })),
      /SESSION_SECRET/,
    );
  });
});

describe("maskSecret", () => {
  test("deja ver solo el final", () => {
    assert.equal(maskSecret("ck_1234567890abcdef"), "······abcdef");
  });

  test("una clave corta no enseña nada", () => {
    assert.equal(maskSecret("abc"), "······");
  });
});
