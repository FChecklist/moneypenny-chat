// C12: secret-field masking. Before a picture is taken, every field that can hold a secret is blanked (value and look), then put back.
// Rules (spec S-062): password, email, tel and number inputs; names or labels that point to a token, key, card, pin or code;
// a value that looks like a card number (13 to 19 digits with spaces or dashes only); anything marked data-mpc-hide.
// Limit: text that is not in a field (plain text on the page) is only hidden when the product marks it data-mpc-hide.
export const SECRET_TYPES = ['password', 'email', 'tel', 'number'];
const HINT = /(pass(word|wd|code)?|pwd|token|secret|otp|\bpin\b|cvv|cvc|card|cc-|iban|api[-_ ]?key|auth|ssn|aadhaar|credential)/i;
const CARD_VALUE = /^\s*\d(?:[ -]?\d){12,18}\s*$/;

export function isSecretField(el) {
  if (!el) return false;
  if (el.hasAttribute && el.hasAttribute('data-mpc-hide')) return true;
  const tag = String(el.tagName || el.tag || '').toLowerCase(); if (tag !== 'input' && tag !== 'textarea') return false;
  const g = (k) => (el.getAttribute ? el.getAttribute(k) : null) || '';
  if (tag === 'input' && SECRET_TYPES.includes((g('type') || el.type || '').toLowerCase())) return true;
  if (['name', 'id', 'autocomplete', 'placeholder', 'aria-label'].some((k) => HINT.test(g(k)))) return true;
  return CARD_VALUE.test(String(el.value || ''));
}
const rectOf = (el) => { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null; return r && [r.x ?? r.left, r.y ?? r.top, r.width, r.height].every(Number.isFinite) ? { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width, h: r.height, mode: 'hide' } : null; };

// Returns {count, rects, restore()}. restore() always puts values and looks back; call it in a finally.
export function maskSecrets(doc) {
  const saved = [], rects = [];
  const hide = (el, blank) => { saved.push({ el, value: el.value, vis: el.style ? el.style.visibility : undefined }); if (blank) el.value = ''; if (el.style) el.style.visibility = 'hidden'; };
  for (const el of doc.querySelectorAll('input, textarea, [data-mpc-hide]')) if (isSecretField(el)) { const r = rectOf(el); if (r) rects.push(r); hide(el, 'value' in el); }
  const zones = [...doc.querySelectorAll('[data-mpc-hide-zone]')]; // the widget panel is never in a picture
  for (const z of zones) hide(z, false);
  let done = false;
  return { count: saved.length - zones.length, rects, restore() { if (done) return; done = true; for (const s of saved.reverse()) { if ('value' in s.el && s.value !== undefined) s.el.value = s.value; if (s.el.style) s.el.style.visibility = s.vis || ''; } } };
}
