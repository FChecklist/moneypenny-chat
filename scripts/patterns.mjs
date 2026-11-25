// Shared patterns for the secrets scan and the history scan. Values found are never printed in full.
export const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{6,}/, 'anthropic key'],
  [/gh[pous]_[A-Za-z0-9]{20,}/, 'github token'],
  [/AKIA[0-9A-Z]{16}/, 'aws key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'e-mail address'],
  [/(?<!\d)[6-9]\d{9}(?!\d)/, 'mobile-like number'],
];
// Addresses that are part of the platform and carry no personal data.
export const ALLOWED_EMAILS = [/^noreply@anthropic\.com$/i, /@users\.noreply\.github\.com$/i];
export function findHits(text) {
  const hits = [];
  for (const [re, name] of PATTERNS) {
    const g = new RegExp(re.source, 'g');
    for (const m of text.matchAll(g)) {
      if (name === 'e-mail address' && ALLOWED_EMAILS.some((a) => a.test(m[0]))) continue;
      hits.push(name);
    }
  }
  return hits;
}
