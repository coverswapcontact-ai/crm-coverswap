import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod/v4";

const resend = new Resend(process.env.RESEND_API_KEY);

const emailSchema = z.object({
  to: z.string().email("Email destinataire invalide"),
  subject: z.string().min(1, "Sujet requis"),
  body: z.string().min(1, "Corps du message requis"),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = emailSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { to, subject, body } = parsed.data;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "CoverSwap <noreply@coverswap.fr>",
      to,
      subject,
      html: body,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { error: "Erreur lors de l'envoi de l'email", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (error) {
    console.error("POST /api/email error:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'envoi de l'email" },
      { status: 500 }
    );
  }
}
