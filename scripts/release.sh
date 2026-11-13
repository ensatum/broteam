#!/usr/bin/env bash
# Если прогноз changelog/unreleased.md не пуст, останавливается.
# Собирает пункты коммитов сборки с прошлого тега в changelog/год.релиз.md
# и коммитит это в develop. Номер релиза не увеличивает.
# Затем перематывает main на этот коммит, собирает пакеты Linux и macOS
# в release/ и ставит тег Год.Релиз. Пакеты в git не входят.
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
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Сначала закоммитьте или уберите локальные изменения." >&2
  exit 1
fi
if ! git show-ref --verify --quiet refs/heads/develop; then
  echo "Ветки develop нет." >&2
  exit 1
fi
if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Ветки main нет." >&2
  exit 1
fi

git checkout develop

version="$(node scripts/version-lib.mjs version)"
tag="$(node scripts/version-lib.mjs tag)"
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null \
  || git ls-remote --exit-code origin "refs/tags/${tag}" >/dev/null; then
  echo "Тег ${tag} уже есть. Сначала сборка в develop поднимет номер релиза." >&2
  exit 1
fi
if ! node scripts/changelog.mjs check; then
  exit 1
fi
if [[ -n "$(node scripts/changelog.mjs forecast)" ]]; then
  echo "Есть коммиты задачи без сборки. Сначала соберите билд: npm run build:dev." >&2
  exit 1
fi

notes="$(node scripts/changelog.mjs release "$tag")"
git add -- "changelog/${tag}.md"
if git diff --cached --quiet; then
  subject="$(git log -1 --format=%s)"
  if [[ "$subject" != "chore(release): ${tag}" && "$subject" != "Release ${tag}" ]]; then
    echo "changelog/${tag}.md не изменился, коммита chore(release): ${tag} нет." >&2
    exit 1
  fi
else
  printf '%s\n' "$notes" | git commit -F -
fi

git checkout main
git merge --ff-only develop || {
  echo "main не перематывается на develop: в main есть свои коммиты." >&2
  exit 1
}

echo "Release ${tag} (${version})"
npm run build

failed=()
build_target() {
  local name="$1"
  shift
  echo "Собираем ${name}"
  if "$@"; then
    return 0
  fi
  echo "Не собралось: ${name}. Остальные платформы продолжаем." >&2
  failed+=("$name")
}

arch="$(node -p 'process.arch')"
node scripts/ensure-native.mjs linux "$arch" || exit 1
build_target "Linux" npx electron-builder --linux AppImage deb "--${arch}" -c.directories.output=release -c.linux.artifactName="BroTeam-${version}-\${arch}.\${ext}"
build_target "macOS" node scripts/dist-mac.mjs
node scripts/prune-artifacts.mjs release 1

shopt -s nullglob
artifacts=(release/*.AppImage release/*.deb release/*-mac.zip)
if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "Ни один пакет не собран." >&2
  exit 1
fi

git tag -a "$tag" -m "chore(release): ${tag}"
git push origin develop
git push origin HEAD
git push origin "$tag"
echo "Тег ${tag} стоит на коммите из develop. Версия ${version}."
echo "Пакеты лежат в release/. Прикрепите их к релизу на GitHub:"
echo "https://github.com/ensatum/broteam/releases/new?tag=${tag}"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Не собрались: ${failed[*]}." >&2
fi
find release -maxdepth 1 -type f -name "*${version}*" | sort
if [[ ${#failed[@]} -gt 0 ]]; then
  exit 1
fi
