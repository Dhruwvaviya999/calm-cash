import type { ReceiptContentType } from '@calmcash/shared';

// Identifies a receipt's type from its bytes. The file name and the declared content type are
// never proof of what a file is: a PDF renamed to .png, or an HTML page labelled image/jpeg, is
// recognised for what it is (or refused). Beyond the leading signature, each format's structure is
// checked where it is cheap to do so, so truncated or obviously corrupt files are refused too.
// This is not malware scanning: no scanner is available, which the documentation states.

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || !startsWith(bytes, [0xff, 0xd8, 0xff])) return false;
  // The end-of-image marker, allowing a little trailing padding some cameras add.
  const tail = bytes.subarray(Math.max(0, bytes.length - 64));
  for (let index = tail.length - 2; index >= 0; index -= 1) {
    if (tail[index] === 0xff && tail[index + 1] === 0xd9) return true;
  }
  return false;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 45 &&
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    ascii(bytes, 12, 16) === 'IHDR' &&
    ascii(bytes, bytes.length - 8, bytes.length - 4) === 'IEND'
  );
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP')
    return false;
  const declared =
    (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  return declared + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(bytes, 12, 16));
}

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return false;
  return ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF');
}

/** The receipt type the content really is, or `undefined` when it is none of them (or damaged). */
export function detectReceiptType(bytes: Uint8Array): ReceiptContentType | undefined {
  if (isJpeg(bytes)) return 'image/jpeg';
  if (isPng(bytes)) return 'image/png';
  if (isWebp(bytes)) return 'image/webp';
  if (isPdf(bytes)) return 'application/pdf';
  return undefined;
}
