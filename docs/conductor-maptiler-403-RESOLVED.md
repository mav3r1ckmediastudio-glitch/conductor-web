# Conductor Web — MapTiler 403 on deployed site: RESOLVED

**Date resolved:** 2 Jul 2026. **Repo:** `mav3r1ckmediastudio-glitch/conductor-web`, branch `master`.
**Deployed at:** `https://conductor-web-live.netlify.app`

This closes out `conductor-maptiler-403-handoff.md` (2 Jul 2026, same day).

## Root cause

Netlify env var `VITE_MAPTILER_KEY` had a stray leading `=` character in the value
(i.e. it was set to `=7DkZfFXHsvdG3ZMivAV6` instead of `7DkZfFXHsvdG3ZMivAV6`). Vite
bakes env vars in at build time, so every production build shipped a malformed key.
MapTiler correctly rejected it with `403 Invalid key`.

This was **not** a code bug, **not** a Netlify config/scoping issue, and **not** an
account/billing/quota issue on the MapTiler side. The earlier hypothesis in the
handoff doc (wrong deploy context / stale build) was reasonable given the symptoms
but was not the actual cause — the value itself was simply malformed.

## Diagnostic path that found it

1. Confirmed the "Default key can't be origin-restricted" fact from MapTiler docs
   (ruled out domain restriction).
2. Fetched `https://api.maptiler.com/maps/dataviz-dark/style.json?key=<key>` directly
   — returned a **valid, complete style.json**, proving the key itself was good in
   isolation.
3. Since the key worked standalone but not from the deployed app, re-checked the
   literal env var value character-by-character in the Netlify dashboard.
4. Found the leading `=`.

## Fix applied

1. Netlify → Environment variables → `VITE_MAPTILER_KEY` → removed leading `=`.
2. Redeployed with cache clear.
3. Hard refresh (`Ctrl+Shift+R`) on live site.

## Verification

- Map renders fully: terrain, water, buildings, fibre routes all visible.
- Console (with "Preserve log" **unticked**, so no stale pre-redeploy entries):
  **0 errors, 0 warnings**, 126/126 elements loading clean, pole layers loading
  successfully.
- Confirmed via screenshot 2 Jul 2026.

## Process note for future sessions

The 403 body was fetchable directly (no browser/DevTools needed) the whole time —
this is the fastest first move for *any* API key/auth error on a public endpoint,
before touching dashboards or walking through screenshots. Also: when checking
Netlify env vars for typos, view the raw value directly rather than assuming a
copy-paste was clean — a single stray character is easy to miss visually but breaks
the build silently (no build error, since it's just a malformed string, not invalid
syntax).

## Status

**CLOSED.** No further action. Do not re-open unless the 403 recurs with a new
error body.
