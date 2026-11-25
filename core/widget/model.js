// S-052 to S-059: the screens as plain data. No DOM here, so tests can walk every screen.
// A view is {id, title, lines[], controls[]}. A control is {kind:'button'|'link'|'text'|'ailine'|'notice', ...}.
import { HOME, OPTIONS, NOTICE, PRIVACY, STANDARD_AI_LINE, FALLBACK_SCREEN } from '../src/strings.js';
export const LIMITS = { suggestMin: 10, textMax: 600, findMax: 120, summary: 100 };
const T = { suggest_types: [['option', 'Option'], ['feature', 'Feature'], ['wording', 'Wording']] };
const btn = (id, label, extra = {}) => ({ kind: 'button', id, label, ...extra });
const back = () => btn('back', 'Back', { secondary: true });
export const initial = () => ({ screen: 'home', topic: null, type: null, text: '', find: '', stuckAt: null, screenLabel: null, shot: false, sent: null, sending: false, error: null, status: null });
const chars = (s) => [...s].length;

// cfg: {strings:{help_topics:[{id,label,answer}], stuck:[{id,label}], screens:[labels], terms_url}, screenLabel}
export function view(st, cfg) {
  const S = cfg.strings, here = cfg.screenLabel || FALLBACK_SCREEN, label = st.stuckAt === null ? here : S.screens[Number(st.stuckAt)] || FALLBACK_SCREEN;
  const notice = { kind: 'notice', text: NOTICE, link: { text: 'Terms', href: S.terms_url } };
  const privacy = { kind: 'privacy', text: PRIVACY };
  const ai = (hint) => [{ kind: 'ailine', text: STANDARD_AI_LINE, copy: 'Copy link', for: hint }];
  switch (st.screen) {
    case 'home': return { id: 'home', title: HOME.title, lines: [HOME.question], controls: [btn('go:help', OPTIONS.help), btn('go:suggest', OPTIONS.suggest), btn('go:stuck', OPTIONS.stuck)], noBack: true };
    case 'help.topics': return { id: '1.1', title: 'Pick a topic', lines: [], controls: [...S.help_topics.map((t) => btn('topic:' + t.id, t.label)), { kind: 'link', id: 'else', label: 'Something else' }, back()] };
    case 'help.answer': { const t = S.help_topics.find((x) => x.id === st.topic); return { id: '1.2', title: t.label, lines: [t.answer || 'No answer is written yet.'], controls: [btn('home', 'Got it'), btn('still', 'Still need help'), ...ai('help'), back()] }; }
    case 'help.else': { const m = cfg.match ? cfg.match(st.find) : []; return { id: '1.3', title: 'Type a few words', lines: st.find && !m.length ? ['No match yet.'] : [], controls: [{ kind: 'text', id: 'find', label: 'A few words', max: LIMITS.findMax, value: st.find }, btn('find', 'Find help'), ...m.slice(0, 3).map((t) => btn('topic:' + t.id, t.label)), ...(st.find && !m.length ? [btn('still', 'Still need help')] : []), back()] }; }
    case 'suggest.type': return { id: '2.1', title: 'What kind of idea?', lines: [], controls: [...T.suggest_types.map(([id, l]) => btn('type:' + id, l)), back()] };
    case 'suggest.write': { const n = chars(st.text); return { id: '2.2', title: 'Write the idea', lines: ['One idea per message. Short is fine.'], controls: [{ kind: 'text', id: 'text', label: 'The idea', multi: true, max: LIMITS.textMax, value: st.text, counter: `${n} of ${LIMITS.textMax}` }, privacy, ...(cfg.capture ? [btn('shot', st.shot ? 'Change screenshot' : 'Add screenshot', { secondary: true })] : []), notice, btn('send', st.sending ? 'Sending' : 'Send', { disabled: n < LIMITS.suggestMin || st.sending }), back()], error: st.error }; }
    case 'suggest.sent': return { id: '2.4', title: 'Sent. Thank you.', lines: [`Idea number ${st.sent.ticket}.`], controls: [btn('home', 'Done'), ...ai('suggest')], noBack: true };
    case 'stuck.where': return { id: '3.1', title: 'Stuck on this screen?', lines: [`Screen: ${here}`], controls: [btn('where:here', 'Yes, this screen'), ...(S.screens.length ? [btn('where:other', 'Another screen')] : []), back()] };
    case 'stuck.pick': return { id: '3.1b', title: 'Pick a screen', lines: [], controls: [...S.screens.map((l, i) => btn('screen:' + i, l)), back()] };
    case 'stuck.what': return { id: '3.2', title: 'What is stuck?', lines: [], controls: [...S.stuck.map((t) => btn('stuck:' + t.id, t.label)), btn('stuck:other', 'Something else'), back()] };
    case 'stuck.write': { const n = chars(st.text); return { id: '3.3', title: 'Write what happened', lines: ['What did you tap? What did you expect?'], controls: [{ kind: 'text', id: 'text', label: 'What happened', multi: true, max: LIMITS.textMax, value: st.text, counter: `${n} of ${LIMITS.textMax}` }, privacy, ...(cfg.capture ? [btn('shot', st.shot ? 'Change screenshot' : 'Take a screenshot', { secondary: true })] : []), btn('next', 'Next', { disabled: st.topic === 'other' && n === 0 }), back()] }; }
    case 'stuck.send': { const t = S.stuck.find((x) => x.id === st.topic); return { id: '3.5', title: 'Check and send', lines: [`Screen: ${label}`, `Stuck: ${t ? t.label : 'Something else'}`, ...(st.text ? [[...st.text].slice(0, LIMITS.summary).join('')] : []), ...(st.shot ? ['Screenshot added'] : [])], controls: [notice, btn('send', st.sending ? 'Sending' : 'Send', { disabled: st.sending }), back()], error: st.error }; }
    case 'stuck.sent': return { id: '3.6', title: 'Sent. Thank you.', lines: [`Problem number ${st.sent.ticket}.`], controls: [btn('home', 'Done'), ...ai('stuck'), { kind: 'link', id: 'status', label: 'Check status' }], noBack: true };
    case 'status': return { id: 'status', title: 'Check status', lines: st.status ? [`Ticket ${st.status.ticket}: ${st.status.status}.`, ...(st.status.team_note ? [st.status.team_note] : [])] : [st.error || 'Looking.'], controls: [btn('home', 'Done')], noBack: true };
    default: throw new Error('unknown screen: ' + st.screen); // refuse, never a silent default
  }
}

// Pure transitions. Input events: {id} for a button, {id, value} for a text box. Returns a new state.
export function step(st, ev) {
  const s = { ...st, error: null }, to = (screen, x = {}) => ({ ...s, screen, ...x });
  const [k, v] = ev.id.split(/:(.*)/s);
  if (k === 'text' || k === 'find') return { ...s, [k]: String(ev.value ?? '').slice(0, k === 'find' ? LIMITS.findMax : LIMITS.textMax) };
  if (k === 'home') return initial();
  if (k === 'back') return BACK[st.screen] ? to(BACK[st.screen]) : s;
  switch (st.screen) {
    case 'home': return k === 'go' ? to({ help: 'help.topics', suggest: 'suggest.type', stuck: 'stuck.where' }[v]) : s;
    case 'help.topics': return k === 'topic' ? to('help.answer', { topic: v }) : k === 'else' ? to('help.else') : s;
    case 'help.else': return k === 'topic' ? to('help.answer', { topic: v }) : k === 'still' ? to('stuck.write', { topic: 'other' }) : s;
    case 'help.answer': return k === 'still' ? to('stuck.write', { topic: st.topic }) : s;
    case 'suggest.type': return k === 'type' ? to('suggest.write', { type: v }) : s;
    case 'stuck.where': return k === 'where' ? (v === 'here' ? to('stuck.what', { stuckAt: null }) : to('stuck.pick')) : s;
    case 'stuck.pick': return k === 'screen' ? to('stuck.what', { stuckAt: v }) : s;
    case 'stuck.what': return k === 'stuck' ? to('stuck.write', { topic: v }) : s;
    case 'stuck.write': return k === 'next' ? (st.topic === 'other' && !st.text.trim() ? s : to('stuck.send')) : s;
    default: return s;
  }
}
const BACK = { 'help.topics': 'home', 'help.answer': 'help.topics', 'help.else': 'help.topics', 'suggest.type': 'home', 'suggest.write': 'suggest.type', 'stuck.where': 'home', 'stuck.pick': 'stuck.where', 'stuck.what': 'stuck.where', 'stuck.write': 'stuck.what', 'stuck.send': 'stuck.write' };

// Ticket body for the send. Never holds a name, address or id of a person; the instance adds the role.
export function ticketBody(st, cfg, page) {
  const base = { screen: page || '/', ...(st.stuckAt !== null ? { screen_label: cfg.strings.screens[Number(st.stuckAt)] } : cfg.screenLabel ? { screen_label: cfg.screenLabel } : {}), ...(st.shotId ? { screenshot_id: st.shotId } : {}) };
  if (st.screen === 'suggest.write') return { ...base, option: 'suggest', type: st.type, text: st.text };
  return { ...base, option: 'stuck', topic: st.topic === 'other' ? null : st.topic, text: st.text };
}
