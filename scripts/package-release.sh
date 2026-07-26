#!/usr/bin/env sh
set -eu

version="${1:-}"

if [ -z "$version" ]; then
  echo "usage: scripts/package-release.sh VERSION" >&2
  exit 1
fi

mkdir -p dist
rm -f "dist/fix-quera-${version}.zip" "dist/fix-quera-firefox-v${version}.zip"

zip -q "dist/fix-quera-${version}.zip" manifest.json content.js page-data-filter.js icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
zip -q "dist/fix-quera-firefox-v${version}.zip" manifest.json content.js page-data-filter.js icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
