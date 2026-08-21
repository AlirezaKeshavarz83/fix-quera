# Chrome Web Store releases

Fix Quera is published as item `ipdgalbogcfdhhjcjljkcpnalkpiehle`. Uploads and publish
requests go through the Chrome Web Store API, so a release does not need the dashboard
unless the listing copy itself changes (see `docs/store-listing.md`).

## One-time credential setup

The API needs an OAuth client owned by the same Google account that owns the store item.

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project.
2. Enable the **Chrome Web Store API** for that project.
3. Configure the OAuth consent screen as **External**, and add the store-owner account under
   **Test users** — while the app is in Testing mode, only listed test users can approve it.
4. Create an OAuth client of type **Desktop app**. Keep the client ID and client secret.
5. Get a refresh token for the `https://www.googleapis.com/auth/chromewebstore` scope. Open
   this URL in a browser signed in as the store owner, replacing `CLIENT_ID`, and approve:

   ```
   https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=CLIENT_ID&redirect_uri=http://localhost:8080&access_type=offline&prompt=consent
   ```

   The browser then fails to load `http://localhost:8080/?code=...`, which is expected: the
   loopback redirect is only a carrier for the code (Google disabled the older `oob` flow).
   Copy the `code` query parameter and exchange it within a few minutes:

   ```sh
   curl -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     --data-urlencode code=AUTH_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost:8080
   ```

   Refresh tokens issued while the consent screen is in Testing mode expire after 7 days
   (`refresh_token_expires_in` in the response). Publish the consent screen to **In
   production** for a token that lasts until it is revoked; otherwise repeat this step
   whenever publishing fails with `invalid_grant`.

Store the three values as Actions repository secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and
`CWS_REFRESH_TOKEN` (Settings → Secrets and variables → Actions). Set the repository variable
`CWS_EXTENSION_ID` only if the item ID ever changes.

## Publishing

After the release PR is merged and tagged, publishing a GitHub Release runs
`.github/workflows/publish-chrome.yml` automatically. The workflow can also be started
manually from the Actions tab with an explicit version, and with `upload_only` when a draft
should be reviewed in the dashboard before submitting.

Locally, with the same three variables exported:

```sh
scripts/publish-chrome.sh 0.5.9              # upload and submit for review
scripts/publish-chrome.sh 0.5.9 --upload-only # upload as a draft
```

The script refuses to run when the requested version does not match `manifest.json`, packages
the archive if it is missing, and treats `ITEM_PENDING_REVIEW` as success: Chrome Web Store
review usually takes hours to days, and the new version goes live only after it passes.

Firefox releases stay manual through the AMO dashboard using
`dist/fix-quera-firefox-v<version>.zip`.
