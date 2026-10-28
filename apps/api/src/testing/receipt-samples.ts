// Tiny but structurally valid receipt files for tests: each passes the content checks of its
// format (signature, required chunks, end markers). They are generated, not real documents.

function bytes(...parts: (readonly number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const char of part) out.push(char.charCodeAt(0));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
}

function littleEndian32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

const webpBody = bytes('WEBP', 'VP8 ', littleEndian32(10), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

export const RECEIPT_SAMPLES = {
  jpeg: bytes(
    [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
    'JFIF',
    [0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xd9],
  ),
  png: bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    [0, 0, 0, 13],
    'IHDR',
    [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0],
    [0x90, 0x77, 0x53, 0xde],
    [0, 0, 0, 0],
    'IEND',
    [0xae, 0x42, 0x60, 0x82],
  ),
  webp: bytes('RIFF', littleEndian32(webpBody.length), [...webpBody]),
  pdf: bytes('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'),
} as const;
