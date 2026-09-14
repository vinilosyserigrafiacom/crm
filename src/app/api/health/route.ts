import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Comprobación de salud para el monitor del servidor. No requiere sesión. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
