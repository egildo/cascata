#!/bin/sh
# A CONSUMER TAG: `<tag>-dist` is `<tag>` plus the built `dist/`, committed on a detached head and never on a branch.
# A git dependency (`git+ssh://…#v1.5.0-dist`) then installs with no compiler and no registry — the case for a private package consumed over the same SSH key that pushes it. Source tags stay clean; `dist/` stays ignored on every branch.
# Usage: sh scripts/dist-tag.sh v1.5.0   (then: git push origin v1.5.0-dist)
set -eu
TAG="${1:?usage: dist-tag.sh vX.Y.Z}"
git diff --quiet && git diff --cached --quiet || { echo "working tree not clean" >&2; exit 1; }
BRANCH="$(git branch --show-current)"
git checkout -q --detach "$TAG"
npm run build
git add -f dist
git commit -q -m "$TAG-dist: $TAG with its built dist, for git consumers"
git tag "$TAG-dist"
git checkout -q "$BRANCH"
echo "tagged $TAG-dist at $(git rev-parse --short "$TAG-dist") — push with: git push origin $TAG-dist"
