#!/bin/bash
# Bump the SDK version and commit.
# Usage: ./scripts/bump-sdk.sh [patch|minor|major]

set -e

BUMP=${1:-patch}
cd "$(dirname "$0")/../packages/sdk"

OLD_VERSION=$(node -p "require('./package.json').version")
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

echo "SDK: $OLD_VERSION → $NEW_VERSION"
echo ""
echo "Commit and push to trigger publish:"
echo "  git add packages/sdk/package.json"
echo "  git commit -m \"sdk: bump to v$NEW_VERSION\""
echo "  git push"
