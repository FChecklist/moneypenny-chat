// S-058: send with an idempotency key and retry. One tap makes one key; a second tap while sending does nothing; a retry reuses the key.
const RETRY = [300, 1200]; // two retries after the first try; only for network faults and 502/503/504
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
export function makeApi({ base = '/mpc', fetchFn = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), token = null } = {}) {
  let inflight = null, key = null;
  async function once(path, init) {
    let last;
    for (let i = 0; i <= RETRY.length; i++) {
      try { const r = await fetchFn(base + path, { ...init, credentials: 'omit', cache: 'no-store' }); if (![502, 503, 504].includes(r.status)) return r; last = r; } catch (e) { last = null; }
      if (i < RETRY.length) await sleep(RETRY[i]);
    }
    return last;
  }
  return {
    // Returns {ok, body} or {ok:false, error}. Same content gets the same key until it is sent; new content gets a new key.
    async send(path, body, { raw = null, contentType = 'application/json', sig = null } = {}) {
      if (inflight) return inflight; // double tap: the first call answers both
      const fp = sig || JSON.stringify(body); if (!key || key.fp !== fp) key = { fp, id: hex() };
      inflight = (async () => {
        try {
          const r = await once(path, { method: 'POST', headers: { 'content-type': contentType, 'idempotency-key': key.id }, body: raw ?? JSON.stringify(body) });
          if (!r) return { ok: false, error: 'try_later' };
          const j = await r.json().catch(() => ({}));
          if (r.status === 201 || r.status === 200) { if (j.status_token) token = j.status_token; key = null; return { ok: true, body: j }; }
          return { ok: false, error: j.error || 'try_later' };
        } finally { inflight = null; }
      })();
      return inflight;
    },
    // S-059: status by ticket number and the status token kept in memory only.
    async status(ticket) {
      if (!token) return { ok: false, error: 'not_found' };
      const r = await once('/v1/tickets/' + encodeURIComponent(ticket), { method: 'GET', headers: { 'x-mpc-status-token': token } });
      const j = r ? await r.json().catch(() => ({})) : {};
      return r && r.status === 200 ? { ok: true, body: j } : { ok: false, error: j.error || 'try_later' };
    },
  };
}
