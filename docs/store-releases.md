# Store releases

Fix Quera ships to the Chrome Web Store as item `ipdgalbogcfdhhjcjljkcpnalkpiehle` and to
addons.mozilla.org as `fix-quera@keshi.dev`. Uploads and submissions for both go through
store APIs, so a release does not need either dashboard unless the listing copy itself
changes (see `docs/store-listing.md`).

Neither API can edit listing metadata: descriptions, screenshots, categories, and privacy
answers stay dashboard-only.

## Chrome Web Store credentials

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

## Firefox Add-ons credentials

AMO authenticates with a JWT signed by an API key pair, created once at
<https://addons.mozilla.org/developers/addon/api/key/> while signed in as the add-on owner.
Store the key as `AMO_JWT_ISSUER` (the `user:12345:67` string) and the secret as
`AMO_JWT_SECRET`. The secret is shown only at creation time; regenerating the key pair
invalidates the old one. Set the repository variable `AMO_ADDON_GUID` only if the add-on GUID
stops matching `browser_specific_settings.gecko.id`.

## Publishing

After the release PR is merged and tagged, publishing a GitHub Release runs
`.github/workflows/publish.yml`, which submits to both stores. The workflow can also be
started manually from the Actions tab with an explicit version, a `stores` choice of
`both`/`chrome`/`firefox`, and `upload_only` when the upload should be reviewed in a dashboard
before submitting.

Locally, with the matching variables exported:

```sh
scripts/publish-chrome.sh 0.5.9                # upload and submit for review
scripts/publish-chrome.sh 0.5.9 --upload-only  # upload as a draft
scripts/publish-firefox.sh 0.5.9               # upload, validate, create the version
scripts/publish-firefox.sh 0.5.9 --upload-only # upload and validate only
```

Both scripts refuse to run when the requested version does not match `manifest.json` and
package the archive if it is missing. The Chrome script treats `ITEM_PENDING_REVIEW` as
success; the Firefox script polls the upload until AMO validation passes, then creates the
listed version with the MIT license (override with `AMO_LICENSE`). Review on both stores is
asynchronous and takes hours to days.
