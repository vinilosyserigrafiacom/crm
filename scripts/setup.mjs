/**
 * Instalación en un solo comando: npm run setup
 *
 * Deja el proyecto listo para `npm run dev` desde un clon recién hecho:
 * instala dependencias si faltan, crea el .env con una clave de sesión
 * generada al azar, aplica las migraciones y carga los datos iniciales.
 *
 * Es idempotente: se puede volver a ejecutar sin miedo. No pisa un .env que ya
 * exista ni vuelve a sembrar una base de datos que ya tenga usuarios.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

/** Marca del .env.example que hay que sustituir por una clave de verdad. */
const PLACEHOLDER_SECRET = "cambia-esto-por-una-clave-larga-y-aleatoria";

const NODE_MINIMO = 20;

function paso(texto) {
  console.log(`\n\x1b[1m${texto}\x1b[0m`);
}

function aviso(texto) {
  console.log(`  \x1b[33m${texto}\x1b[0m`);
}

function ok(texto) {
  console.log(`  \x1b[32m${texto}\x1b[0m`);
}

function abortar(texto) {
  console.error(`\n\x1b[31m${texto}\x1b[0m\n`);
  process.exit(1);
}

/**
 * Ejecuta un comando enseñando su salida.
 *
 * shell: true es necesario en Windows, donde npx y prisma son ficheros .cmd
 * que no se pueden lanzar directamente.
 */
function ejecutar(comando) {
  const resultado = spawnSync(comando, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (resultado.status !== 0) {
    abortar(`Ha fallado: ${comando}`);
  }
}

function generarClave() {
  return randomBytes(48).toString("base64");
}

// --- 1. Versión de Node ------------------------------------------------------

const mayor = Number(process.versions.node.split(".")[0]);
if (mayor < NODE_MINIMO) {
  abortar(
    `Este proyecto necesita Node.js ${NODE_MINIMO} o superior y estás usando la ${process.versions.node}.\n` +
      "Descárgala en https://nodejs.org y vuelve a ejecutar: npm run setup",
  );
}

console.log(
  `\nPreparando el CRM de Vinilos y Serigrafía (Node ${process.versions.node})`,
);

// --- 2. Dependencias ---------------------------------------------------------

paso("1/4 · Dependencias");
if (existsSync(join(root, "node_modules", "next"))) {
  ok("Ya instaladas.");
} else {
  ejecutar("npm install");
}

// --- 3. Fichero de entorno ---------------------------------------------------

paso("2/4 · Configuración (.env)");
if (existsSync(envPath)) {
  const contenido = readFileSync(envPath, "utf8");
  if (contenido.includes(PLACEHOLDER_SECRET)) {
    // Sustituir la clave de ejemplo es seguro: es pública, así que nadie puede
    // estar usándola en serio, y dejarla puesta sí sería un problema.
    writeFileSync(
      envPath,
      contenido.replace(PLACEHOLDER_SECRET, generarClave()),
    );
    ok(
      "Tenías la clave de ejemplo en SESSION_SECRET; la he cambiado por una de verdad.",
    );
  } else {
    ok("Ya existe y no se toca.");
  }
} else {
  if (!existsSync(examplePath)) {
    abortar("Falta .env.example. ¿Está el clon completo?");
  }
  const plantilla = readFileSync(examplePath, "utf8");
  writeFileSync(envPath, plantilla.replace(PLACEHOLDER_SECRET, generarClave()));
  ok("Creado a partir de .env.example, con una clave de sesión nueva.");
}

// --- 4. Base de datos --------------------------------------------------------

paso("3/4 · Base de datos");
ejecutar("npx prisma migrate deploy");
ejecutar("npx prisma generate");

paso("4/4 · Datos iniciales");
ejecutar("npx tsx prisma/seed.ts");

// --- 5. Qué hacer ahora ------------------------------------------------------

console.log(`
\x1b[1mTodo listo.\x1b[0m Arranca con:

    npm run dev

y entra en http://localhost:3000 con el usuario y la contraseña de arriba.

Nada más entrar conviene que hagas dos cosas:
  1. Ajustes → cambia la contraseña y rellena los datos del taller (CIF,
     dirección, IBAN). Son los que salen en la cabecera de los presupuestos.
  2. Revisa el catálogo y borra los clientes de ejemplo: son inventados, solo
     están para que las pantallas no se vean vacías.
`);

if (process.env.NODE_ENV === "production") {
  aviso(
    "Ojo: estás en NODE_ENV=production. Para un servidor de verdad, revisa la\n" +
      "  sección de despliegue del README (HTTPS y copias de seguridad).",
  );
}
