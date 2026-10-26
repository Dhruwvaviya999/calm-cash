// Turns a User-Agent header into a coarse label ("Firefox on Android") so people can recognise their
// sessions. Only the browser family and operating system are kept: no versions, device models, or
// IP addresses, which would add fingerprinting detail without helping the user.

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const OPERATING_SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPad\b/, 'iPadOS'],
  [/\b(?:iPhone|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const MAX_INPUT_LENGTH = 512;

function match(source: string, rules: readonly (readonly [RegExp, string])[]): string | undefined {
  return rules.find(([pattern]) => pattern.test(source))?.[1];
}

export function describeUserAgent(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined || userAgent.length === 0) {
    return undefined;
  }
  const source = userAgent.slice(0, MAX_INPUT_LENGTH);
  const browser = match(source, BROWSERS);
  const system = match(source, OPERATING_SYSTEMS);

  if (browser !== undefined && system !== undefined) {
    return `${browser} on ${system}`;
  }
  return browser ?? system;
}
