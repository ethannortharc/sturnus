#!/bin/sh
# The release archive: dist/sturnus-<version>.tar.gz (and its sha256), made from a clean checkout whose HEAD is tagged
# v<version> (VERSION names it). Unpack it anywhere and run ./sturnus install there.
set -eu
cd "$(dirname "$0")/.."
v=$(cat VERSION)
[ -z "$(git status --porcelain)" ] || { echo "release.sh: uncommitted changes; release from a clean checkout" >&2; exit 1; }
[ "$(git describe --exact-match --tags HEAD 2>/dev/null)" = "v$v" ] || { echo "release.sh: HEAD is not tagged v$v" >&2; exit 1; }
mkdir -p dist
git archive --format=tar.gz --prefix="sturnus-$v/" -o "dist/sturnus-$v.tar.gz" "v$v"
(cd dist && shasum -a 256 "sturnus-$v.tar.gz" > "sturnus-$v.tar.gz.sha256")
echo "dist/sturnus-$v.tar.gz"
