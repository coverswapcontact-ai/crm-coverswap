/** Mission 13 (lot 7) : qui a écrit le mail — partagé par le lecteur et ses fenêtres, dans un module à part pour éviter l'import circulaire. */
export function expediteur(message: { sens: string; de: string; deNom: string | null; a: string[] }): string {
  if (message.sens === "SORTANT") return `À ${message.a.join(", ") || "?"}`;
  return message.deNom ? `${message.deNom} <${message.de}>` : message.de;
}
