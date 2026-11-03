#!/usr/bin/env bash
# Поднимает номер билда, собирает AppImage в builds/ и публикует коммит в develop на origin.
# Локальные изменения develop входят в этот же коммит. Год берётся из текущей даты.
# Номер релиза не меняется. Тегов нет.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Это не git-репозиторий: $root" >&2
  exit 1
fi
if [[ -d .git/rebase-merge || -d .git/rebase-apply || -f .git/MERGE_HEAD ]]; then
  echo "Сначала завершите rebase или merge." >&2
  exit 1
fi

if git show-ref --verify --quiet refs/heads/develop; then
  git checkout develop
elif git show-ref --verify --quiet refs/remotes/origin/develop; then
  git checkout -b develop --track origin/develop
else
  git checkout -b develop
fi

version="$(node scripts/bump-version.mjs build)"
echo "Build ${version}"
npm run build
npx electron-builder --linux AppImage -c.directories.output=builds -c.linux.artifactName="BroTeam-${version}.\${ext}"
node scripts/prune-artifacts.mjs builds 3

git add -A
if git diff --cached --quiet; then
  echo "Нечего коммитить." >&2
  exit 1
fi
git commit -m "$(cat <<EOF
Build ${version}

EOF
)"
git push -u origin HEAD
echo "Build ${version} закоммичен в develop и отправлен в репозиторий."
