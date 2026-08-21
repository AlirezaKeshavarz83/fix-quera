#!/usr/bin/env bash
set -euo pipefail

# Uploads a packaged release zip to the Chrome Web Store and optionally publishes it.
#
# Required environment:
#   CWS_CLIENT_ID      OAuth client ID of a Google Cloud desktop client
#   CWS_CLIENT_SECRET  OAuth client secret for that client
#   CWS_REFRESH_TOKEN  Refresh token for that client, scoped to the Chrome Web Store API
# Optional environment:
#   CWS_EXTENSION_ID   Defaults to the published Fix Quera item
#   CWS_TARGET         Publish target: default (public) or trustedTesters
#
# Usage:
#   scripts/publish-chrome.sh VERSION [--upload-only]

version="${1:-}"
mode="${2:-}"

if [ -z "$version" ]; then
  echo "usage: scripts/publish-chrome.sh VERSION [--upload-only]" >&2
  exit 1
fi

if [ -n "$mode" ] && [ "$mode" != "--upload-only" ]; then
  echo "unknown option: $mode" >&2
  exit 1
fi

extension_id="${CWS_EXTENSION_ID:-ipdgalbogcfdhhjcjljkcpnalkpiehle}"
publish_target="${CWS_TARGET:-default}"
archive="dist/fix-quera-${version}.zip"

for name in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN; do
  if [ -z "${!name:-}" ]; then
    echo "missing required environment variable: $name" >&2
    exit 1
  fi
done

manifest_version="$(node -e "process.stdout.write(require('./manifest.json').version)")"
if [ "$manifest_version" != "$version" ]; then
  echo "manifest.json is at $manifest_version but $version was requested" >&2
  exit 1
fi

if [ ! -f "$archive" ]; then
  scripts/package-release.sh "$version"
fi

echo "Requesting an access token"
access_token="$(
  curl -sS -f -X POST https://oauth2.googleapis.com/token \
    -d "client_id=${CWS_CLIENT_ID}" \
    -d "client_secret=${CWS_CLIENT_SECRET}" \
    -d "refresh_token=${CWS_REFRESH_TOKEN}" \
    -d grant_type=refresh_token |
    node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const t=JSON.parse(s).access_token;if(!t){throw new Error('no access token in token response')}process.stdout.write(t)})"
)"

echo "Uploading $archive to $extension_id"
upload_response="$(
  curl -sS -f -X PUT \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-api-version: 2" \
    -T "$archive" \
    "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extension_id}"
)"
echo "$upload_response"

node -e "
const response = JSON.parse(process.argv[1]);
if (response.uploadState !== 'SUCCESS') {
  throw new Error('upload failed: ' + JSON.stringify(response.itemError ?? response));
}
" "$upload_response"

if [ "$mode" = "--upload-only" ]; then
  echo "Uploaded as a draft; skipping publish"
  exit 0
fi

echo "Publishing to $publish_target"
publish_response="$(
  curl -sS -f -X POST \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-api-version: 2" \
    -H "Content-Length: 0" \
    "https://www.googleapis.com/chromewebstore/v1.1/items/${extension_id}/publish?publishTarget=${publish_target}"
)"
echo "$publish_response"

node -e "
const response = JSON.parse(process.argv[1]);
const statuses = response.status ?? [];
const failures = statuses.filter((status) => status !== 'OK' && status !== 'ITEM_PENDING_REVIEW');
if (failures.length > 0) {
  throw new Error('publish failed: ' + JSON.stringify(response));
}
" "$publish_response"

echo "Done. Chrome Web Store review can take a few hours to a few days."
