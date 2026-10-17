const NAIRA = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const NAIRA_WITH_KOBO = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });

/**
 * Kobo to "₦20,000". Display only: dividing by 100 in floating point is fine for
 * showing a number, never for money maths (the server does all of that in integers).
 */
export function formatNaira(kobo: number | bigint): string {
  const value = Number(kobo);
  return value % 100 === 0 ? NAIRA.format(value / 100) : NAIRA_WITH_KOBO.format(value / 100);
}

/** Fills `{amount}` in a content string with the naira amount. */
export function withAmount(text: string, kobo: number | bigint): string {
  return text.replaceAll("{amount}", formatNaira(kobo));
}
