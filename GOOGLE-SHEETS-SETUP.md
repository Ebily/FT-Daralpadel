# FT — Google Sheets shared storage setup

FT remains a static GitHub Pages website, but its expense records are now stored in one Google Sheet so the same data appears on different browsers and devices.

## 1. Create the Google Sheet

1. Create a new Google Sheet, for example **FT Financial Tracker Data**.
2. Copy the spreadsheet ID from the URL. It is the long text between `/d/` and `/edit`.

## 2. Add the Apps Script API

1. In the Sheet choose **Extensions → Apps Script**.
2. Delete the default code and paste everything from `google-apps-script/Code.gs`.
3. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your spreadsheet ID.
4. Replace `CHANGE_THIS_TO_YOUR_PRIVATE_FT_KEY` with a long random private key, for example 30+ random characters.
5. Click **Save**.

## 3. Deploy the Apps Script

1. Choose **Deploy → New deployment**.
2. Deployment type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone** (or the broadest option your Google account permits).
5. Deploy and authorize the script.
6. Copy the Web App URL ending in `/exec`.

## 4. Connect FT

Open `config.js` in the FT website folder and set:

```js
window.FT_CONFIG = {
  apiUrl: 'YOUR_WEB_APP_EXEC_URL',
  accessKey: 'THE_SAME_PRIVATE_KEY_FROM_CODE_GS'
};
```

The access key must match exactly in both files.

## 5. Upload FT to GitHub Pages

Upload `index.html`, `styles.css`, `app.js`, and `config.js` to the repository used for GitHub Pages. The `google-apps-script` folder does not need to be hosted; it is included only as the server-side Apps Script source.

## How synchronization works

- Google Sheets is the shared source of truth.
- FT keeps a local browser cache for fast loading and offline fallback.
- Adding, editing, deleting, or importing expenses updates Google Sheets.
- Business name and currency are also stored in the shared Sheet.
- On startup FT downloads the latest Sheet data.
- If the Sheet is empty but the old FT browser contains local records, FT automatically migrates those local records into the Sheet.

## Security note

This setup is appropriate for a small trusted internal business workflow. Because a static GitHub Pages site necessarily exposes its client-side configuration to anyone who can inspect the site, the access key is not equivalent to secure user authentication. If FT will hold sensitive business data or be publicly accessible, the next step should be Google Sign-In/Firebase Authentication or a private backend with per-user authorization.


## IMPORTANT — Bridge version

This corrected FT version uses an Apps Script HTML bridge instead of browser `fetch()` calls.
After replacing `Code.gs`, go to **Deploy → Manage deployments → Edit → New version → Deploy**.
Keep **Execute as: Me** and **Who has access: Anyone**.
The `/exec` URL can stay the same when you update the existing deployment.
Then upload the new `app.js` to GitHub and hard-refresh the FT page.
