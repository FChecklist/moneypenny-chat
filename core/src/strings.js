// Shared screen text of the contract (S-006 rules apply). Instances carry their own strings.json for the rest.
export const STANDARD_AI_LINE = 'Copy this link and paste in your AI to work.';
export const HOME = { title: 'Moneypenny Chat', question: 'What do you need?', close: 'Close' };
export const OPTIONS = { help: 'Need help', suggest: 'Suggest an option or feature', stuck: 'Stuck: tell where' };
export const NOTICE = 'Sending shares this with the Moneypenny team. Read the Terms.'; // "Terms" is a hyperlink in the widget; no tick box
export const PRIVACY = 'Please do not type passwords or card numbers.';
export const FALLBACK_SCREEN = 'This screen';
export const ERROR_TEXT = {
  bad_request: 'Something in the request is wrong. Check the fields.',
  bad_signature: 'The signature is wrong or too old.',
  no_assertion: 'The role proof is missing or not valid.',
  origin: 'This origin is not allowed.',
  role: 'Only an organizer or a co-organizer can do this.',
  not_found: 'Not found.',
  idempotency_conflict: 'This key was already used with different content.',
  too_large: 'The request is too large.',
  bad_type: 'This file type is not accepted.',
  rate: 'Too many requests. Try again later.',
  try_later: 'Please try again in a moment.',
  no_team_login: 'Team login is needed.',
};
