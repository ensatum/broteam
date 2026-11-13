#!/usr/bin/env bash
# Собирает AppImage в builds/ и публикует коммит в develop на origin.
# main не вливается. Грязное дерево не берёт: задачи уже лежат отдельными коммитами.
# Если тег текущего релиза уже есть, поднимаются релиз и сборка. Иначе только сборка.
# Тело коммита — заголовки этих коммитов. Тот же коммит очищает changelog/unreleased.md.
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

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Сначала закоммитьте изменения задачи в develop. Сборка их в свой коммит не заберёт." >&2
  exit 1
fi
if ! node scripts/changelog.mjs check; then
  exit 1
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

notes="$(node scripts/changelog.mjs forecast)"
msg="$(node scripts/changelog.mjs build-message "$version")"
node scripts/changelog.mjs clear
git add -A
if git diff --cached --quiet; then
  printf '%s\n' "$notes" | node scripts/changelog.mjs restore
  git add -- changelog/unreleased.md
  echo "Нечего коммитить." >&2
  exit 1
fi
if ! printf '%s\n' "$msg" | git commit -F -; then
  printf '%s\n' "$notes" | node scripts/changelog.mjs restore
  git add -- changelog/unreleased.md
  exit 1
fi
git push -u origin HEAD
echo "Build ${version} закоммичен в develop и отправлен в репозиторий."
