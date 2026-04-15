import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/* ────────────────────────────────────────────────────────────
   Rate limiting en mémoire (reset sur cold start — acceptable)
──────────────────────────────────────────────────────────── */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 15 * 60_000; // 15 min

function tooManyLoginAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  if (entry.count >= LOGIN_MAX) return true;
  entry.count++;
  return false;
}

/* ────────────────────────────────────────────────────────────
   HTTP Basic Auth — première barrière avant tout
──────────────────────────────────────────────────────────── */
function checkBasicAuth(request: NextRequest): boolean {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;
  // Si les vars ne sont pas définies, on désactive le Basic Auth (dev)
  if (!expectedUser || !expectedPass) return true;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(header.slice(6));
    const [user, pass] = decoded.split(":");
    return user === expectedUser && pass === expectedPass;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────
   Middleware principal
──────────────────────────────────────────────────────────── */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* 1. Routes publiques (webhook site + healthcheck Railway) */
  const isPublicRoute =
    pathname === "/api/webhook" ||
    pathname === "/api/health";

  /* 2. HTTP Basic Auth sur tout sauf routes publiques */
  if (!isPublicRoute && !checkBasicAuth(request)) {
    return new NextResponse("Authentification requise", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="CRM CoverSwap", charset="UTF-8"',
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  /* 3. Rate limiting sur login */
  if (pathname === "/api/auth/callback/credentials" && request.method === "POST") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (tooManyLoginAttempts(ip)) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessaye dans 15 minutes." },
        { status: 429, headers: { "X-Robots-Tag": "noindex, nofollow" } }
      );
    }
  }

  /* 4. Auth NextAuth sur routes protégées */
  const protectedPaths = [
    "/dashboard", "/leads", "/devis", "/factures", "/chantiers",
    "/commandes", "/finances", "/analytics", "/assistant",
    "/api/leads", "/api/devis", "/api/factures", "/api/chantiers",
    "/api/commandes", "/api/assistant", "/api/email", "/api/pdf",
  ];
  const needsAuth = protectedPaths.some((p) => pathname.startsWith(p));

  if (needsAuth) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
      }
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  /* 5. Headers sécurité + noindex global */
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  // Match tout sauf _next, favicon, fichiers statiques
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico)$).*)"],
};
