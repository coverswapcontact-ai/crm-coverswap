import { redirect } from "next/navigation";

export default async function DevisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/devis/${id}/edit`);
}
