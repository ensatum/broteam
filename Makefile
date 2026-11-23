.DEFAULT_GOAL := help
.PHONY: help build release build-last live

WHAT ?= build
TYPE ?= appimage
ARCH ?=

help: ## эта справка
	@printf '%s\n' \
		'make help                         эта справка' \
		'make build                        билд: AppImage в builds/, коммит в develop' \
		'make release                      релиз: пакеты в release/, тег' \
		'' \
		'make live                         текущий код; закрывает уже открытый BroTeam' \
		'make build-last                   AppImage версии из git; нет файла — собрать без бампа' \
		'make build-last WHAT=release      запустить последний релиз, AppImage' \
		'make build-last TYPE=deb          открыть последний такой пакет' \
		'make build-last WHAT=release TYPE=mac ARCH=arm64' \
		'make build-last WHAT=release TYPE=win'

build: ## билд: AppImage в builds/, коммит в develop
	npm run build:dev

release: ## релиз: пакеты в release/, тег
	npm run release

live: ## текущий код; закрывает уже открытый BroTeam
	node scripts/live.mjs

build-last: ## AppImage версии из git; нет файла — собрать без бампа (WHAT, TYPE, ARCH)
	node scripts/open-artifact.mjs --what "$(WHAT)" --type "$(TYPE)" --arch "$(ARCH)"
