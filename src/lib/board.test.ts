import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOARD_STEP, positionsFor, reorder } from "./board";

describe("reorder", () => {
  it("deja la tarjeta al final cuando no se suelta sobre ninguna", () => {
    assert.deepEqual(reorder(["a", "b", "c"], "d", null), ["a", "b", "c", "d"]);
  });

  it("inserta delante de la tarjeta sobre la que se suelta", () => {
    assert.deepEqual(reorder(["a", "b", "c"], "d", "b"), ["a", "d", "b", "c"]);
  });

  it("mueve dentro de la misma columna sin duplicar", () => {
    assert.deepEqual(reorder(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
    assert.deepEqual(reorder(["a", "b", "c"], "a", null), ["b", "c", "a"]);
  });

  it("soltar una tarjeta sobre sí misma la manda al final, sin romper nada", () => {
    assert.deepEqual(reorder(["a", "b", "c"], "b", "b"), ["a", "c", "b"]);
  });

  it("si la referencia ya no está, la deja al final en lugar de fallar", () => {
    // Pasa cuando otra persona ha movido esa tarjeta mientras arrastrábamos.
    assert.deepEqual(reorder(["a", "b"], "c", "desaparecida"), ["a", "b", "c"]);
  });

  it("nunca pierde ni repite tarjetas", () => {
    const columna = ["a", "b", "c", "d", "e"];
    for (const movida of columna) {
      for (const referencia of [...columna, null]) {
        const resultado = reorder(columna, movida, referencia);
        assert.equal(resultado.length, columna.length, `${movida} → ${referencia}`);
        assert.equal(new Set(resultado).size, columna.length, `${movida} → ${referencia}`);
      }
    }
  });
});

describe("positionsFor", () => {
  it("numera de diez en diez para poder insertar en medio", () => {
    assert.deepEqual(
      [...positionsFor(["a", "b", "c"])],
      [
        ["a", BOARD_STEP],
        ["b", BOARD_STEP * 2],
        ["c", BOARD_STEP * 3],
      ],
    );
  });

  it("una columna vacía no tiene posiciones", () => {
    assert.equal(positionsFor([]).size, 0);
  });
});
