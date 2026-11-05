#!/usr/bin/env bash
# Вливает develop в main, поднимает номер релиза (билд не сбрасывается)
# и собирает пакеты Linux и macOS в release/. Год берётся из текущей даты.
# Коммит — полная версия со сборкой, тег — Год.Релиз без номера сборки.
# Коммит и тег отправляются в origin. Пакеты остаются в release/ и в git не входят.
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
if ! git diff --quiet || ! git diff --cached --quiet; then
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

git checkout main
git merge --no-edit develop

version="$(node scripts/bump-version.mjs release)"
tag="${version%.*}"
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  git checkout -- package.json
  echo "Тег ${tag} уже есть." >&2
  exit 1
fi

echo "Release ${tag}"
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

build_target "Linux" npx electron-builder --linux AppImage deb -c.directories.output=release -c.linux.artifactName="BroTeam-${version}-\${arch}.\${ext}"
build_target "macOS" node scripts/dist-mac.mjs
node scripts/prune-artifacts.mjs release 1

shopt -s nullglob
artifacts=(release/*.AppImage release/*.deb release/*-mac.zip)
if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "Ни один пакет не собран." >&2
  exit 1
fi
git add package.json
if git diff --cached --quiet; then
  echo "Нечего коммитить." >&2
  exit 1
fi
git commit -m "$(cat <<EOF
Release ${version}

EOF
)"
git tag -a "$tag" -m "Release ${tag}"
git push origin HEAD
git push origin "$tag"
echo "Release ${version} закоммичен в main и отмечен тегом ${tag}."
echo "Пакеты лежат в release/. Прикрепите их к релизу на GitHub:"
echo "https://github.com/ensatum/broteam/releases/new?tag=${tag}"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Не собрались: ${failed[*]}." >&2
fi
find release -maxdepth 1 -type f -name "*${version}*" | sort
if [[ ${#failed[@]} -gt 0 ]]; then
  exit 1
fi
