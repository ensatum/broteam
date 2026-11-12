#!/usr/bin/env bash
# Собирает AppImage в builds/ и публикует коммит в develop на origin.
# main не вливается. Локальные изменения develop входят в этот же коммит.
# Если тег текущего релиза уже есть, поднимаются релиз и сборка. Иначе только сборка.
# Тело коммита — changelog/unreleased.md. Тот же коммит очищает файл.
# Пустой файл оставляет тело пустым, сборка из-за этого не останавливается.
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

current_tag="$(node scripts/version-lib.mjs tag)"
if git rev-parse -q --verify "refs/tags/${current_tag}" >/dev/null \
  || git ls-remote --exit-code origin "refs/tags/${current_tag}" >/dev/null; then
  node scripts/bump-version.mjs release >/dev/null
fi
version="$(node scripts/bump-version.mjs build)"
arch="$(node -p 'process.arch')"
echo "Build ${version}"
npm run build
node scripts/ensure-native.mjs linux "$arch"
npx electron-builder --linux AppImage "--${arch}" -c.directories.output=builds -c.linux.artifactName="BroTeam-${version}.\${ext}"
node scripts/prune-artifacts.mjs builds 3

notes="$(node scripts/changelog.mjs unreleased)"
node scripts/changelog.mjs clear
git add -A
if git diff --cached --quiet; then
  printf '%s\n' "$notes" | node scripts/changelog.mjs restore
  git add -- changelog/unreleased.md
  echo "Нечего коммитить." >&2
  exit 1
fi
msg="Build ${version}"
if [[ -n "$notes" ]]; then
  msg+=$'\n\n'"$notes"
fi
if ! git commit -m "$msg"; then
  printf '%s\n' "$notes" | node scripts/changelog.mjs restore
  git add -- changelog/unreleased.md
  exit 1
fi
git push -u origin HEAD
echo "Build ${version} закоммичен в develop и отправлен в репозиторий."
