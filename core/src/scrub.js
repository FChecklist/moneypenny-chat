// S-020: e-mail, phone and card-like digits become [removed] before storage.
const REMOVED = '[removed]';
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const RUN = /(?<![\w])\+?\(?\d[\d\s\-().]{5,}\d(?![\w])/g; // a run of digits with common separators
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function scrub(text) {
  return String(text)
    .replace(EMAIL, REMOVED)
    .replace(RUN, (m) => (DATE.test(m) || m.replace(/\D/g, '').length < 8 ? m : REMOVED));
}
