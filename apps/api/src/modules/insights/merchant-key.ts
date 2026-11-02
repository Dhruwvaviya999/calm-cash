// Grouping keys for descriptions and merchants. Bank descriptions carry reference numbers, dates,
// and punctuation that differ on every line; removing them lets the same payee be recognised
// across transactions. Pure and deterministic; never used as a claim about who the payee is.

/** Lower case, digits and punctuation removed, at most four words: `"UPI/SWIGGY/1234"` → `"upi swiggy"`. */
export function descriptionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 4)
    .join(' ')
    .slice(0, 120);
}

/** The grouping key of a transaction: its merchant when known, otherwise its description. */
export function payeeKey(merchant: string | null | undefined, description: string): string {
  const fromMerchant = merchant === null || merchant === undefined ? '' : descriptionKey(merchant);
  return fromMerchant.length >= 3 ? fromMerchant : descriptionKey(description);
}
