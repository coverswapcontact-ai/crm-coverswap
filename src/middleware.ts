import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // For API routes, return 401
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    // For pages, redirect to sign in
    const signInUrl = new URL("/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/leads/:path*",
    "/devis/:path*",
    "/factures/:path*",
    "/chantiers/:path*",
    "/commandes/:path*",
    "/finances/:path*",
    "/analytics/:path*",
    "/assistant/:path*",
    "/api/leads/:path*",
    "/api/devis/:path*",
    "/api/factures/:path*",
    "/api/chantiers/:path*",
    "/api/commandes/:path*",
    "/api/assistant/:path*",
    "/api/email/:path*",
    "/api/pdf/:path*",
  ],
};
