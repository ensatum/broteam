# BroTeam

Десктоп-приложение (Electron) для стендапа по agile-доске команды в Yandex Tracker.

Репозиторий: [github.com/ensatum/broteam](https://github.com/ensatum/broteam).

## Возможности

- Настройки подключения (токен / Cloud Org ID — как у MCP)
- Выбор разработчиков, колонок доски с цветами, спринтов
- Живая матрица количества задач по разработчикам и колонкам
- Правая панель: ключ-ссылка, заметки, обновление статуса из Трекера
- Заметки по разработчику
- Неизменяемые снапшоты на дату + календарь

## Разработка

Нужны Node.js 20+ и npm.

```bash
npm install
npm run dev
```

## Сборка Linux

```bash
npm run dist:linux
```

Артефакты: `release/*.AppImage`, `release/*.deb`.

## Сборка macOS (с Linux)

```bash
npm run dist:mac
```

Артефакты (без подписи Apple):
- `release/BroTeam-*-mac.zip` — Intel (x64)
- `release/BroTeam-*-arm64-mac.zip` — Apple Silicon

DMG здесь не собирается (нужен macOS). На Mac: распаковать zip, при первом запуске — ПКМ → Открыть (приложение не подписано).

## Сборка Windows

```bash
npm run dist:win
```

(удобнее на Windows или в CI)

Данные приложения хранятся в `~/.config/bro-team/` (Linux). Если там ещё нет базы, при запуске сюда переносится каталог старой установки: `tracker-standup`, `BroTeam` или `BroTracker`.
