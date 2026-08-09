# FT sync fix — root cause, decision, and deployment steps

## 1. Root cause

`ftApi` never showed up in Executions because `google.script.run` never actually fired — not a timeout, not a permissions error, a silent no-op.

`google.script.run` is not a normal API call. It works by having the HtmlService page load a second, hidden, Google-controlled sandbox iframe (on a `*.googleusercontent.com` "user code" domain) and talking to it over an internal `postMessage` protocol. That internal wrapper iframe only accepts messages that match Google's own expected origin/parent chain — it was built on the assumption that the HtmlService page *is* the top-level page the user navigated to (or is embedded inside Google's own UI, e.g. a Workspace add-on sidebar). It ignores messages from a setup it doesn't recognize.

In FT's case the chain was:

```
github.io page (real top-level, 3rd-party origin)
  -> iframe: script.google.com/.../exec   (your doGet HTML)
       -> Google's own internal sandbox iframe (script.run's real channel)
```

That's a third-party iframe nested one level deeper than Google's plumbing expects. `doGet` still executes fine and returns HTML — that's just an HTTP GET, no special channel needed. But the moment your bridge script calls `google.script.run....ftApi(...)`, the *internal* call setup fails quietly before it ever reaches Apps Script's execution backend. No request, no error callback, nothing in Executions. This matches exactly what you saw.

This isn't a bug you can patch around with more `ALLOWALL`, more origin whitelisting, or another postMessage listener — `XFrameOptionsMode.ALLOWALL` only controls whether *your* iframe is allowed to load. It has no effect on Google's separate internal sandbox channel that `google.script.run` depends on.

**Answering your specific questions:**

1. Why it fails: see above — `google.script.run`'s internal transport breaks under nested cross-origin iframing.
2. Is `google.script.run` meant only for Apps Script-served pages? Yes. Google's own docs scope it to "the client-side JavaScript of an HTML service page" — i.e. pages Apps Script serves and the user is directly on (or an add-on surface). It was never designed or supported for embedding inside an arbitrary third-party site's iframe.
3. Is the iframe + postMessage + `google.script.run` chain architecturally wrong for GitHub Pages? Yes. It depends on an undocumented internal implementation detail of Google's sandbox, which can break with any Chrome/Safari third-party-iframe or storage-partitioning change, with no official support contract. Not something to run financial data on.
4. Most reliable architecture for GitHub Pages + Google Sheets, no Firebase/SQL: treat the Apps Script Web App as a plain JSON HTTP API (`doGet`/`doPost` + `ContentService`) and call it with ordinary `fetch()`. This is a fully supported, standard HTTP request — not an Apps Script implementation detail.

## 2. Options considered

| Option | Verdict |
|---|---|
| A. Apps Script as REST endpoint (`doGet`/`doPost` + `ContentService` JSON, called via `fetch`) | **Chosen.** Standard HTTP, no iframe, works from any browser/device, no extra infrastructure. |
| B. JSONP for reads | Works for GET only, no real auth (key sits in a `<script src>` URL, gets logged everywhere), can't do writes. Unnecessary now that plain `fetch()` works. |
| C. Host FT entirely inside Apps Script HtmlService, use `google.script.run` directly | Would work (now same-origin, top-level), but throws away GitHub Pages, git-based deploys, custom domain, and normal static hosting workflow. Bigger change than needed. |
| D. GitHub Pages as a redirect/launcher into Apps Script | Same trade-off as C, just with an extra hop. Not needed. |
| E. Google Sheets API directly with OAuth | Requires every user to sign in with Google and consent, plus client-side token handling. Overkill for a small business shared-expense sheet; adds real complexity for no benefit here. |
| F. External serverless proxy (Cloudflare Worker, etc.) | Solves nothing that Option A doesn't already solve, and adds infrastructure you explicitly want to avoid. Only worth it if you later want to hide the Apps Script URL entirely or add real user accounts. |

**Recommendation: Option A.** It's the standard, widely-used pattern for exactly this "static site + Google Sheets backend" case, requires zero new services, and keeps GitHub Pages exactly as-is.

## 3. Recommended architecture

```
GitHub Pages (static: index.html, styles.css, config.js, app.js)
        │
        │  fetch() over HTTPS — POST for reads & writes, plain JSON body
        ▼
Google Apps Script Web App  (doGet / doPost → ContentService JSON)
        │  runs as the script owner (Execute as: Me)
        ▼
Google Sheet  (FT_Expenses, FT_Settings) — single shared source of truth

localStorage on each device = optional offline cache only (unchanged).
```

No iframe. No `postMessage`. No `google.script.run`. The browser makes one HTTP request per action, same as calling any REST API.

## 4. What changed in the code

- **`Code.gs`** (and the duplicate under `google-apps-script/`, kept in sync — see the note at the top of that file about not pasting both into one Apps Script project): `doGet` no longer returns a bridge HTML page. `doGet`/`doPost` now both return `ContentService` JSON directly. All the action logic moved from `ftApi` into `handleAction_`, which now *always* returns `{ok:false,error:...}` on failure instead of throwing — so the client always gets parseable JSON back, even on error, instead of Apps Script's generic HTML error page.
- **`app.js`**: the entire iframe/bridge block (`ensureBridge`, `FT_BRIDGE*`, the `window.addEventListener('message', ...)` listener) is gone. `cloudRequest()` is now a single `fetch()` call. Everything downstream — `syncCloud`, `cloudMutation`, dashboard, expenses, import/export, settings — is untouched, since they only ever called `cloudRequest()` and didn't care how it was implemented.
- **`config.js`**: unchanged. Same `apiUrl` (the `/exec` URL) and `accessKey` — you're pointing at the same deployment, just with different code behind it.

### Why POST with `Content-Type: text/plain`

A cross-origin `fetch()` with `Content-Type: application/json` triggers a CORS **preflight** (an `OPTIONS` request) before the real POST. Apps Script web apps have no reliable way to answer that preflight. Sending the JSON body with `Content-Type: text/plain;charset=utf-8` instead keeps the request a CORS "simple request" — no preflight — and Apps Script's `/exec` endpoint (deployed with "Anyone" access) responds with the permissive CORS headers needed for the browser to let your JS read the response. The server (`doPost`) just does `JSON.parse()` on the raw text body itself; the client and server still exchange real structured JSON, only the transport-level content type differs.

## 5. Security model — read this before treating `ACCESS_KEY` as real protection

Be clear-eyed about what `FT_CFG.accessKey` in `config.js` actually is: **it is not a secret.** It ships in a static JS file served to every visitor and is visible in "View Source," browser dev tools, and the GitHub repo itself if the repo is public. Calling it a "private key" would be misleading.

What it actually does: it's a shared password that keeps the endpoint from being casually discovered and hit by randoms or scrapers who stumble on the `/exec` URL. It is a speed bump, not a lock. Anyone who has the URL and opens dev tools can read it and call the API directly.

The real security boundary in this architecture is elsewhere: the Apps Script runs "Execute as: Me," so the Google Sheet itself is never directly exposed — only the specific `ftApi` actions you wrote are reachable, and only through your validation logic. That's the actual attack surface, and it's the same size whether you're using this fetch-based approach or the old iframe one.

Practical guidance for a small business:
- Treat this as "protected against casual/accidental access," not "protected against a motivated attacker." Don't put anything in this sheet you wouldn't be comfortable being exposed if the key leaked (bank account numbers, full card numbers, personal ID numbers).
- Rotate `ACCESS_KEY` if you ever suspect it's leaked (e.g., repo went public with it in history).
- If you later need real protection (e.g., only specific staff can write), the correct upgrade is Google Sign-In: restrict the Apps Script deployment or add a server-side check against a list of allowed Google account emails (`Session.getActiveUser().getEmail()`) with the deployment set to a Google Workspace domain, or accept an OAuth ID token from the client and verify it server-side. That's a real auth boundary — a longer string in `config.js` never will be. This is a future upgrade, not required to fix today's sync bug.

## 6. Deployment steps

1. In the Apps Script project (script.google.com), open **Code.gs** and replace its entire contents with the new `Code.gs` from this package. (If your project only has one script file, ignore the `google-apps-script/` copy — it's a repo-only duplicate for reference.)
2. Save (Ctrl/Cmd+S).
3. **Deploy → Manage deployments → your existing Web App deployment → Edit (pencil) → Version: New version → Deploy.**
   - Using "New version" on the *existing* deployment keeps the same `/exec` URL, so `config.js` does not need to change.
   - If you instead create a brand-new deployment, you'll get a new `/exec` URL — copy it into `config.js`'s `apiUrl`.
4. Confirm deployment settings are still **Execute as: Me**, **Who has access: Anyone**.
5. Replace `app.js` on GitHub Pages with the new version from this package (`config.js`, `index.html`, `styles.css` are unchanged — no need to touch them).
6. Commit and push. GitHub Pages will redeploy automatically.
7. Test: open the site, open DevTools → Network tab, add an expense, and confirm you see a `POST` to `.../exec` returning `{"ok":true}`. Then open the site in a different browser (or your phone) and confirm the same expense appears.
8. Check Apps Script **Executions** — you should now see `doPost` (or `doGet`) executions logged every time you use the app, which confirms the request is actually reaching the backend (the thing that was silently failing before).

## 7. Sanity check you can run right now, without touching the frontend

Once redeployed, paste this into any browser console (or run as a `curl`) to confirm the backend itself is fixed, independent of the GitHub Pages app:

```js
fetch('https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'bootstrap', key: 'FT-2026-daralpadel-Hamid' })
}).then(r => r.json()).then(console.log);
```

You should get back `{ok: true, expenses: [...], settings: {...}}`. If this works from a bare console but the app still shows offline, the problem has moved to the frontend (check `config.js`'s `apiUrl` matches your deployment, and check the Network tab for the actual error).
