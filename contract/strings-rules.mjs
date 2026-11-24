// S-006: owner string rules for every screen text. Shared by the core and every instance.
export const STANDARD_AI_LINE = 'Copy this link and paste in your AI to work.';
const BANNED = [
  [/\b(my|mine|your|yours)\b/i, 'my/your'],
  [/\bhost(s)?\b/i, 'host (say co-organizer)'],
  [/\b(we|our|ours|us)\b/i, 'we/our/us'],
  [/\bID\b/, 'bare ID'],
  [/\b(tick ?box|check ?box|tick the box|nickname)\b/i, 'tick box or nickname wording'],
];
// Returns a list of problems for one string. The standard AI line is allowed exactly as written.
export function badWords(text) {
  const t = String(text).split(STANDARD_AI_LINE).join('');
  return BANNED.filter(([re]) => re.test(t)).map(([, n]) => n);
}
// Walks any object or array of strings. Returns [{path, problems}].
export function checkStrings(value, path = '') {
  if (typeof value === 'string') { const p = badWords(value); return p.length ? [{ path, problems: p }] : []; }
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => checkStrings(v, path ? `${path}.${k}` : k));
  return [];
}
