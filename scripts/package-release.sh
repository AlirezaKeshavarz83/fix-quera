#!/usr/bin/env sh
set -eu

version="${1:-}"

if [ -z "$version" ]; then
  echo "usage: scripts/package-release.sh VERSION" >&2
  exit 1
fi

mkdir -p dist
rm -f "dist/fix-quera-${version}.zip" "dist/fix-quera-firefox-v${version}.zip"

zip -q -j "dist/fix-quera-${version}.zip" manifest.json content.js
zip -q -j "dist/fix-quera-firefox-v${version}.zip" manifest.json content.js
