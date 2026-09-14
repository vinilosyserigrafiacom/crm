import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Guarda de acceso. Solo comprueba la firma de la cookie, que es lo que se
 * puede hacer en el runtime edge; la comprobación de que el usuario sigue
 * activo la hace requireUser() en cada página del servidor.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Se recuerda a dónde quería ir para llevarle allí tras el login.
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (session && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Se excluyen los recursos estáticos y el endpoint de salud, que tiene que
  // responder sin sesión para que lo pueda usar un monitor externo.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
