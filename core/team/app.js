// Team list page. Same-origin calls only. All text goes in with textContent, never as HTML.
const $ = (id) => document.getElementById(id);
let cursor = null, current = null;
const say = (t) => { $('msg').textContent = t; };
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) { say('Something went wrong. Try again.'); throw new Error(String(r.status)); }
  return r;
}
const q = (extra) => { const p = new URLSearchParams(extra); if ($('product').value) p.set('product', $('product').value.trim()); if ($('status').value) p.set('status', $('status').value); return p.toString(); };
async function load(more) {
  say('');
  const j = await (await api('GET', '/v1/team/tickets?' + q(more && cursor ? { cursor } : {}))).json();
  if (!more) $('rows').textContent = '';
  for (const t of j.items) {
    const tr = document.createElement('tr');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t.ticket; b.addEventListener('click', () => open(t));
    const first = document.createElement('td'); first.appendChild(b); tr.appendChild(first);
    for (const v of [t.product, t.option, t.topic || '', t.screen_label, t.created, t.status]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    $('rows').appendChild(tr);
  }
  cursor = j.cursor; $('more').hidden = !cursor;
  if (!j.items.length && !more) say('No tickets.');
}
async function open(t) {
  current = t;
  const d = await (await api('GET', '/v1/team/tickets/' + t.ticket + '?product=' + encodeURIComponent(t.product))).json();
  $('dh').textContent = 'Ticket ' + d.ticket; $('meta').textContent = d.product + ' / ' + d.option + ' / ' + d.screen_label + ' / ' + d.status;
  $('body').textContent = d.text || '(no text)'; $('note').value = d.team_note || '';
  $('shot').textContent = '';
  const r = await fetch('/v1/team/tickets/' + t.ticket + '/screenshot?product=' + encodeURIComponent(t.product), { credentials: 'same-origin', cache: 'no-store' });
  if (r.ok) { const img = document.createElement('img'); img.alt = 'Screenshot sent with the ticket'; img.src = URL.createObjectURL(await r.blob()); $('shot').appendChild(img); }
  $('detail').hidden = false; $('dh').tabIndex = -1; $('dh').focus();
}
async function patch(body) { await api('PATCH', '/v1/team/tickets/' + current.ticket + '?product=' + encodeURIComponent(current.product), body); }
$('filters').addEventListener('submit', (e) => { e.preventDefault(); load(false).catch(() => {}); });
$('more').addEventListener('click', () => load(true).catch(() => {}));
for (const s of ['seen', 'done']) $(s).addEventListener('click', async () => { await patch({ status: s, team_note: $('note').value }).catch(() => null); await load(false).catch(() => {}); });
$('erase').addEventListener('click', async () => { if (!confirm('Erase this ticket now?')) return; await patch({ erase: true }).catch(() => null); $('detail').hidden = true; await load(false).catch(() => {}); });
load(false).catch(() => {});
