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
// C6 (E6): what an AI sees on an error. Every error is {error, message, next}.
export const AI_ERRORS = {
  bad_link: { status: 401, message: 'This link is not valid.', next: 'Ask the organizer to copy a new link.' },
  expired: { status: 401, message: 'This link has ended.', next: 'Ask the organizer to copy a new link.' },
  revoked: { status: 401, message: 'The organizer stopped this link.', next: 'Stop. Do not retry.' },
  forbidden_action: { status: 403, message: 'This action is not allowed for an AI. Payments, identity changes and deleting are never allowed.', next: 'Tell the organizer a person must do it. Post a blocked note.' },
  out_of_scope: { status: 403, message: 'This action is outside the scopes of this link.', next: 'Check the scopes in step 2.' },
  ticket_gone: { status: 404, message: 'The ticket was erased.', next: 'Stop.' },
  plan_not_approved: { status: 409, message: 'The organizer has not approved the plan yet.', next: 'Wait and call step 2 again after 30 seconds.' },
  too_large: { status: 413, message: 'The note is too long.', next: 'Shorten it to 800 characters.' },
  bad_note: { status: 422, message: 'The note has a type or text that is not accepted.', next: 'Use plan, step, done or blocked.' },
  slow_down: { status: 429, message: 'Too many calls.', next: 'Wait the number of seconds in retry_after and try again.' },
  try_later: { status: 503, message: 'The service is busy.', next: 'Wait 60 seconds and try again.' },
};
// What the response to a note says comes next (E5).
export const AI_NEXT = {
  plan: 'Wait for approved:true from GET /v1/ai/context, or continue if the ticket is a help-only question.',
  step: 'Continue, or go to step 6 when done or blocked.',
  done: 'The link is closed. Tell the organizer what happened.',
  blocked: 'The link is closed. Tell the organizer what happened.',
};
