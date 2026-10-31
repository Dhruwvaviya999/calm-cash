// The grounding check. A model may word an answer, but every number in its wording must already
// appear in the facts it was given (amounts, counts, percentages, dates) or in the person's own
// question. One unsupported number and the whole wording is replaced by a fixed template — the
// figures shown beside it always come from the deterministic services anyway.

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** `"1,23,456.70"` → `"123456.7"`; `"05"` → `"5"`. */
export function normalizeNumber(token: string): string {
  const plain = token.replace(/,/g, '');
  const [whole = '0', fraction] = plain.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction?.replace(/0+$/, '') ?? '';
  return decimals === '' ? integer : `${integer}.${decimals}`;
}

/** Every number written in `text`, normalised. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => normalizeNumber(match[0]));
}

export interface GroundingFacts {
  /** Text the model was shown (formatted figures, dates, labels). */
  factTexts: readonly string[];
  /** The person's question (numbers they wrote may be repeated). */
  question: string;
}

/** Numbers the wording may contain. Rounded forms of decimals are allowed too ("₹1,200"). */
export function allowedNumbers({ factTexts, question }: GroundingFacts): Set<string> {
  const allowed = new Set<string>();
  for (const text of [...factTexts, question]) {
    for (const number of numbersIn(text)) {
      allowed.add(number);
      const [whole] = number.split('.');
      if (whole !== undefined) allowed.add(whole);
    }
  }
  return allowed;
}

export function isGrounded(wording: string, facts: GroundingFacts): boolean {
  const allowed = allowedNumbers(facts);
  return numbersIn(wording).every((number) => allowed.has(number));
}

/** A small, safe Markdown subset: no HTML, no links, no images, bounded length. */
export function sanitizeWording(text: string, maxChars: number): string {
  const cleaned = text
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1)}…`;
}
