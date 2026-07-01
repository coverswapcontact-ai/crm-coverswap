import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * DIAGNOSTIC EMAIL TEMPORAIRE — à supprimer après usage.
 * Tente un envoi Resend avec la config actuelle et renvoie l'erreur exacte,
 * pour savoir précisément pourquoi les notifications de leads ne partent pas.
 * Protégé par un token en query.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("k") !== "cs-mail-diag-7q") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const hasKey = !!process.env.RESEND_API_KEY;
  const keyPrefix = process.env.RESEND_API_KEY?.slice(0, 5) || null;
  const from = process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>";
  const to = process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr";

  if (!hasKey) {
    return NextResponse.json({
      hasKey,
      from,
      to,
      verdict: "RESEND_API_KEY absent sur Railway → aucun email possible.",
    });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const r = await resend.emails.send({
      from,
      to,
      subject: "✅ Test configuration email CoverSwap",
      html: "<p>Si vous recevez ceci, les notifications de leads fonctionnent.</p>",
    });
    return NextResponse.json({
      hasKey,
      keyPrefix,
      from,
      to,
      sendData: r.data,
      sendError: r.error,
      verdict: r.error
        ? "Resend a refusé l'envoi — voir sendError (souvent : domaine expéditeur non vérifié)."
        : "Envoi accepté par Resend — vérifiez la réception (et les spams).",
    });
  } catch (e) {
    return NextResponse.json({
      hasKey,
      keyPrefix,
      from,
      to,
      exception: e instanceof Error ? e.message : String(e),
    });
  }
}
