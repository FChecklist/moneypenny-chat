# Team login (Cloudflare Access)

The team list page `/team` and every call under `/v1/team/*` need a login. The core does not make its own login. It checks the signed token that Cloudflare Access adds to each request (header `cf-access-jwt-assertion`).

## Set up (owner, once)
1. In Cloudflare Zero Trust, add a self-hosted application for the core host. Cover the paths `/team*` and `/v1/team/*`. Allow only team members.
2. Copy the team domain (like `<team>.cloudflareaccess.com`) and the application audience tag.
3. Put them in `core/wrangler.toml`: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. They are not secrets.
4. Set `TEAM_URL` to the https origin of the core (no path). The team mail links to `TEAM_URL/team`.

## What the core checks
- The token is signed (RS256) with a key from `https://<team domain>/cdn-cgi/access/certs`.
- Issuer is the team domain, the audience tag matches, the token has not expired.
- If the domain or the tag is empty, or the keys cannot be fetched, every team call answers 401. The routes stay closed.

## Not checked
Not checked against a real Access application in this run: no Cloudflare account was used. The checks are tested with a locally made key pair. Test it once on the real setup before use.

## Why 401 and not a redirect
Access itself redirects a browser to the login page before the request reaches the core. A request that gets through without a valid token is not from a person who logged in, so the core answers 401.
