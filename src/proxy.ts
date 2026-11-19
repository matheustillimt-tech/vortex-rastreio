import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Protege o painel quando o Supabase está configurado: renova a sessão e manda
 * quem não está logado para /login. Sem Supabase (modo local) não faz nada.
 * APIs públicas (coleta, webhooks, cron) e arquivos estáticos ficam fora do matcher.
 */
export async function proxy(request: NextRequest) {
  // página de teste do script (chave de desenvolvimento) nunca é servida em produção
  if (request.nextUrl.pathname === "/lp-teste.html" && process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (request.nextUrl.pathname === "/lp-teste.html") return NextResponse.next();

  // modo local forçado (só fora de produção): sem login real, mesma regra de src/lib/env.ts
  const forceLocal = process.env.NODE_ENV !== "production" && process.env.RASTRO_LOCAL === "1";
  const url = forceLocal ? "" : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = forceLocal ? "" : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|t\\.js).*)"],
};
