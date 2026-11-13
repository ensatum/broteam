.DEFAULT_GOAL := help
.PHONY: help build release open

WHAT ?= build
TYPE ?= appimage
ARCH ?=

help: ## эта справка
	@printf '%s\n' \
		'make help                         эта справка' \
		'make build                        билд: AppImage в builds/, коммит в develop' \
		'make release                      релиз: пакеты в release/, тег' \
		'' \
		'make open                         запустить последний билд, AppImage' \
		'make open WHAT=release            запустить последний релиз, AppImage' \
		'make open TYPE=deb                открыть последний такой пакет' \
		'make open WHAT=release TYPE=mac ARCH=arm64' \
		'make open WHAT=release TYPE=win'

build: ## билд: AppImage в builds/, коммит в develop
	npm run build:dev

release: ## релиз: пакеты в release/, тег
	npm run release

open: ## открыть последний пакет (WHAT, TYPE, ARCH)
	node scripts/open-artifact.mjs --what "$(WHAT)" --type "$(TYPE)" --arch "$(ARCH)"
