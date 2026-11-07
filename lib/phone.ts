// Phone numbers for WhatsApp, in E.164 form. No server imports, so the browser
// and tests can use it too.
const E164 = /^\+[1-9]\d{7,14}$/;

/** "+91 98765-43210", "0091…" or a 10-digit Indian mobile → "+919876543210"; null if invalid. */
export function normalizeWhatsAppNumber(input: string): string | null {
  let n = input.replace(/[\s\-().]/g, "");
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  // Sellers are mostly in India: accept a bare 10-digit mobile number.
  if (/^[6-9]\d{9}$/.test(n)) n = `+91${n}`;
  return E164.test(n) ? n : null;
}
