/**
 * Prueba de extremo a extremo de la subida a Mailrelay.
 *
 * Levanta un servidor que imita la API de Mailrelay y ejecuta la subida de
 * verdad contra una base de datos temporal. Lo que hay que comprobar aquí no es
 * que se den altas —eso es lo fácil— sino lo otro: que una baja saque a la
 * persona del grupo, que sacarla de un grupo no la saque de los demás, que
 * repetir la subida no haga nada y que, si Mailrelay deja de decir a qué grupos
 * pertenece cada uno, la subida se pare antes de escribir.
 *
 *     npm run test:mailrelay
 */

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directorio = mkdtempSync(join(tmpdir(), "crm-mr-"));
process.env.DATABASE_URL = `file:${join(directorio, "prueba.db")}`;

execFileSync("npx", ["prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });

// --- Cuenta de Mailrelay simulada ------------------------------------------

interface Suscriptor {
  id: number;
  email: string;
  name: string;
  status: string;
  group_ids: number[];
}

const GRUPO_TALLER = 11;
const GRUPO_OTRO = 22;

const grupos = [
  { id: GRUPO_TALLER, name: "Clientes del taller", subscribers_count: 0 },
  { id: GRUPO_OTRO, name: "Boletín general", subscribers_count: 0 },
];

const suscriptores: Suscriptor[] = [];
let siguienteId = 100;

/** Cuando es false, la API deja de decir a qué grupos pertenece cada uno. */
let devolverGrupos = true;

/** Las peticiones de escritura que ha recibido la cuenta, para poder contarlas. */
const escrituras: { email: string; group_ids: number[] }[] = [];

const POR_PAGINA = 100;

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.headers["x-auth-token"] !== "clave-de-prueba") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "sin credenciales" }));
    return;
  }

  const responder = (codigo: number, cuerpo: unknown) => {
    res.writeHead(codigo, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };

  if (req.method === "GET" && url.pathname === "/api/v1/groups") {
    return responder(200, grupos);
  }

  if (req.method === "GET" && url.pathname === "/api/v1/subscribers") {
    const pagina = Number(url.searchParams.get("page") ?? "1");
    const trozo = suscriptores.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    return responder(
      200,
      trozo.map((s) => (devolverGrupos ? s : { ...s, group_ids: undefined })),
    );
  }

  if (req.method === "POST" && url.pathname === "/api/v1/subscribers/sync") {
    let cuerpo = "";
    req.on("data", (trozo) => (cuerpo += trozo));
    req.on("end", () => {
      const datos = JSON.parse(cuerpo) as {
        email: string;
        name?: string;
        status?: string;
        group_ids: number[];
      };
      escrituras.push({ email: datos.email, group_ids: datos.group_ids });

      const clave = datos.email.trim().toLowerCase();
      const existente = suscriptores.find((s) => s.email.toLowerCase() === clave);
      if (existente) {
        existente.name = datos.name ?? existente.name;
        existente.group_ids = datos.group_ids;
        return responder(200, existente);
      }
      const nuevo: Suscriptor = {
        id: (siguienteId += 1),
        email: datos.email,
        name: datos.name ?? "",
        status: datos.status ?? "active",
        group_ids: datos.group_ids,
      };
      suscriptores.push(nuevo);
      // La respuesta envuelta en { data: … }, que es la otra forma que admite
      // el cliente: así se prueban las dos.
      return responder(201, { data: nuevo });
    });
    return;
  }

  responder(404, { message: "no existe" });
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

/** Los correos que están ahora mismo en el grupo del taller. */
function enElGrupo(): string[] {
  return suscriptores
    .filter((s) => s.group_ids.includes(GRUPO_TALLER))
    .map((s) => s.email)
    .sort();
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { pushSegmentToMailrelay } = await import("../src/lib/mailrelay-push");
  const prisma = new PrismaClient();

  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === "string") {
    throw new Error("el servidor de prueba no ha arrancado");
  }
  const config = {
    baseUrl: `http://127.0.0.1:${direccion.port}`,
    apiKey: "clave-de-prueba",
  };

  // --- Datos del CRM -------------------------------------------------------
  const conConsentimiento = { marketingConsentAt: new Date("2026-01-15T10:00:00Z") };

  await prisma.customer.createMany({
    data: [
      { code: "C-1", legalName: "Rótulos Pisuerga S.L.", email: "rotulos@example.com", ...conConsentimiento },
      { code: "C-2", legalName: "Bar El Descanso", email: "bar@example.com", ...conConsentimiento },
      { code: "C-3", legalName: "Sin consentimiento S.L.", email: "callado@example.com" },
      { code: "C-4", legalName: "Se dio de baja S.A.", email: "baja@example.com", ...conConsentimiento, marketingOptOut: true },
    ],
  });

  const segmento = await prisma.segment.create({
    data: {
      name: "Clientes con consentimiento",
      kind: "DYNAMIC",
      rulesJson: JSON.stringify({ onlyActive: true }),
      onlyWithConsent: true,
    },
  });

  const subir = () =>
    pushSegmentToMailrelay({
      config,
      segment: segmento,
      groupId: GRUPO_TALLER,
      groupName: "Clientes del taller",
      userId: null,
    });

  // --- 1. Primera subida ---------------------------------------------------
  console.log("\n1. PRIMERA SUBIDA");
  const primera = await subir();
  comprobar("altas", primera.added, 2);
  comprobar("ya estaban", primera.kept, 0);
  comprobar("sacados", primera.removed, 0);
  comprobar("avisos", primera.warnings.length, 0);
  comprobar("en el grupo", enElGrupo(), ["bar@example.com", "rotulos@example.com"]);
  comprobar("el que no consintió no sube", enElGrupo().includes("callado@example.com"), false);
  comprobar("el que se dio de baja tampoco", enElGrupo().includes("baja@example.com"), false);

  const guardado = await prisma.segment.findUnique({
    where: { id: segmento.id },
    select: { mailrelayGroupId: true, mailrelayGroupName: true, mailrelaySyncedCount: true },
  });
  comprobar("queda enlazado al grupo", guardado?.mailrelayGroupId, GRUPO_TALLER);
  comprobar("con su nombre", guardado?.mailrelayGroupName, "Clientes del taller");
  comprobar("y el tamaño de la lista", guardado?.mailrelaySyncedCount, 2);

  // --- 2. Repetir no hace nada ---------------------------------------------
  console.log("\n2. REPETIR LA SUBIDA");
  escrituras.length = 0;
  const segunda = await subir();
  comprobar("no da altas de nuevo", segunda.added, 0);
  comprobar("los cuenta como que ya estaban", segunda.kept, 2);
  comprobar("no escribe nada en Mailrelay", escrituras.length, 0);

  // --- 3. Una baja saca del grupo ------------------------------------------
  console.log("\n3. UNA BAJA SACA DEL GRUPO");
  await prisma.customer.update({
    where: { code: "C-2" },
    data: { marketingOptOut: true },
  });
  const tercera = await subir();
  comprobar("lo saca", tercera.removed, 1);
  comprobar("queda solo el otro", enElGrupo(), ["rotulos@example.com"]);
  comprobar(
    "pero sigue existiendo en Mailrelay",
    suscriptores.some((s) => s.email === "bar@example.com"),
    true,
  );

  // --- 4. Salir de un grupo no saca de los demás ---------------------------
  console.log("\n4. SALIR DE UN GRUPO NO SACA DE LOS DEMÁS");
  // Alguien que ya estaba en Mailrelay, en otro grupo, y que ahora entra aquí.
  suscriptores.push({
    id: (siguienteId += 1),
    email: "veterano@example.com",
    name: "Veterano del boletín",
    status: "active",
    group_ids: [GRUPO_OTRO],
  });
  await prisma.customer.create({
    data: {
      code: "C-5",
      legalName: "Veterano del boletín",
      email: "veterano@example.com",
      ...conConsentimiento,
    },
  });

  await subir();
  const veterano = suscriptores.find((s) => s.email === "veterano@example.com");
  comprobar("entra en el grupo nuevo", veterano?.group_ids.includes(GRUPO_TALLER), true);
  comprobar("y conserva el que tenía", veterano?.group_ids.includes(GRUPO_OTRO), true);

  await prisma.customer.update({ where: { code: "C-5" }, data: { marketingOptOut: true } });
  await subir();
  const trasSalir = suscriptores.find((s) => s.email === "veterano@example.com");
  comprobar("al darse de baja sale de este", trasSalir?.group_ids.includes(GRUPO_TALLER), false);
  comprobar("pero se queda en el otro", trasSalir?.group_ids, [GRUPO_OTRO]);

  // --- 5. Sin información de grupos, no se escribe -------------------------
  console.log("\n5. SI MAILRELAY NO DICE LOS GRUPOS, NO SE ESCRIBE");
  await prisma.customer.update({ where: { code: "C-2" }, data: { marketingOptOut: false } });
  devolverGrupos = false;
  escrituras.length = 0;
  try {
    await subir();
    fallos.push("debería haberse parado y no lo ha hecho");
    console.log("  ✗ debería haberse parado");
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    const util = mensaje.includes("grupos");
    console.log(`  ${util ? "✓" : "✗"} se para con un motivo claro: ${mensaje.slice(0, 60)}…`);
    if (!util) fallos.push("el error no explica por qué se ha parado");
  }
  comprobar("y no ha escrito nada", escrituras.length, 0);
  devolverGrupos = true;

  // --- 6. Mailrelay no responde --------------------------------------------
  console.log("\n6. MAILRELAY NO RESPONDE");
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  try {
    await subir();
    fallos.push("una cuenta caída debería lanzar un error y no lo ha hecho");
    console.log("  ✗ debería haber fallado");
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    const util = mensaje.includes("conectar") || mensaje.includes("Mailrelay");
    console.log(`  ${util ? "✓" : "✗"} error legible: ${mensaje.slice(0, 60)}…`);
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
          : "La subida a Mailrelay se comporta como debe."),
    );
    process.exit(fallos.length ? 1 : 0);
  });
