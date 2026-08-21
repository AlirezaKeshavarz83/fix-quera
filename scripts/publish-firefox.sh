#!/usr/bin/env bash
set -euo pipefail

# Submits a packaged release zip to addons.mozilla.org as a new listed version.
#
# Required environment:
#   AMO_JWT_ISSUER  API key ("user:12345:67") from the AMO developer API keys page
#   AMO_JWT_SECRET  API secret for that key
# Optional environment:
#   AMO_ADDON_GUID  Defaults to the manifest's gecko id
#   AMO_LICENSE     SPDX license slug for the version, defaults to MIT
#   AMO_CHANNEL     listed (default) or unlisted
#
# Usage:
#   scripts/publish-firefox.sh VERSION [--upload-only]

version="${1:-}"
mode="${2:-}"

if [ -z "$version" ]; then
  echo "usage: scripts/publish-firefox.sh VERSION [--upload-only]" >&2
  exit 1
fi

if [ -n "$mode" ] && [ "$mode" != "--upload-only" ]; then
  echo "unknown option: $mode" >&2
  exit 1
fi

for name in AMO_JWT_ISSUER AMO_JWT_SECRET; do
  if [ -z "${!name:-}" ]; then
    echo "missing required environment variable: $name" >&2
    exit 1
  fi
done

api="https://addons.mozilla.org/api/v5"
channel="${AMO_CHANNEL:-listed}"
license="${AMO_LICENSE:-MIT}"
guid="${AMO_ADDON_GUID:-$(node -e "process.stdout.write(require('./manifest.json').browser_specific_settings.gecko.id)")}"
archive="dist/fix-quera-firefox-v${version}.zip"

manifest_version="$(node -e "process.stdout.write(require('./manifest.json').version)")"
if [ "$manifest_version" != "$version" ]; then
  echo "manifest.json is at $manifest_version but $version was requested" >&2
  exit 1
fi

if [ ! -f "$archive" ]; then
  scripts/package-release.sh "$version"
fi

jwt="$(
  node -e '
    const crypto = require("node:crypto");
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const issued = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.AMO_JWT_ISSUER,
      jti: crypto.randomBytes(16).toString("hex"),
      iat: issued,
      exp: issued + 300,
    };
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
    const signature = crypto
      .createHmac("sha256", process.env.AMO_JWT_SECRET)
      .update(unsigned)
      .digest("base64url");
    process.stdout.write(`${unsigned}.${signature}`);
  '
)"

echo "Uploading $archive to the $channel channel"
upload_response="$(
  curl -sS -X POST "${api}/addons/upload/" \
    -H "Authorization: JWT ${jwt}" \
    -F "channel=${channel}" \
    -F "upload=@${archive}"
)"

upload_uuid="$(
  node -e "
    let response;
    try {
      response = JSON.parse(process.argv[1]);
    } catch {
      throw new Error('upload endpoint returned non-JSON: ' + process.argv[1]);
    }
    if (!response.uuid) {
      throw new Error('upload failed: ' + JSON.stringify(response));
    }
    process.stdout.write(response.uuid);
  " "$upload_response"
)"
echo "Upload $upload_uuid created"

echo "Waiting for validation"
for _ in $(seq 1 60); do
  status="$(curl -sS -f "${api}/addons/upload/${upload_uuid}/" -H "Authorization: JWT ${jwt}")"
  state="$(
    node -e "
      const upload = JSON.parse(process.argv[1]);
      process.stdout.write(upload.processed ? (upload.valid ? 'valid' : 'invalid') : 'pending');
    " "$status"
  )"
  case "$state" in
    valid)
      break
      ;;
    invalid)
      echo "$status"
      echo "validation failed" >&2
      exit 1
      ;;
    *)
      sleep 5
      ;;
  esac
done

if [ "$state" != "valid" ]; then
  echo "validation did not finish in time; upload $upload_uuid stays usable" >&2
  exit 1
fi

if [ "$mode" = "--upload-only" ]; then
  echo "Validated upload $upload_uuid; skipping version creation"
  exit 0
fi

echo "Creating version $version for $guid"
curl -sS -f -X POST "${api}/addons/addon/${guid}/versions/" \
  -H "Authorization: JWT ${jwt}" \
  -H "Content-Type: application/json" \
  -d "{\"upload\":\"${upload_uuid}\",\"license\":\"${license}\"}"

echo
echo "Done. AMO review is asynchronous; the version goes live once it passes."
