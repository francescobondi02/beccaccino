# BECCA — Beccaccino Online

A real-time online version of Beccaccino, the Italian card game for 4 players
in 2 teams. Play in a laptop or desktop browser, or on a phone with the native
app. Practice games put you against 3 bots.

| Folder | What it is |
| --- | --- |
| [backend/](./backend/README.md) | Node 24, Express 5, Socket.IO, Prisma, PostgreSQL. Owns the game. |
| [frontend/](./frontend/README.md) | React 18 and Vite website. |
| [mobile/](./mobile/README.md) | Expo app for iOS and Android, run in Expo Go. |
| [ai/](./ai/README.md) | Python game engine, bot training and the bot service. |

One repository, no npm workspaces: each Node folder has its own
`package.json` and lockfile.

## Run locally

You need only Docker and make. Node, Python, Postgres and Metro run in
containers with hot reload.

```sh
make dev     # build, start, wait until healthy, print the URLs and the Expo QR code
make qr      # print the Expo Go URL and QR code again
make logs    # follow the logs of all services
make test    # backend, frontend and mobile tests
make stop    # stop the containers, keep the data
make reset   # delete the database and dependency volumes, then make dev
```

| Service | Address |
| --- | --- |
| Web | http://localhost:8081 |
| API | http://localhost:8000 |
| Metro (Expo Go) | `exp://<LAN IP>:8082` |
| Bot service | http://localhost:8011/health |
| Adminer | http://localhost:8080 (server `db`, user and password `postgres`) |
| PostgreSQL | localhost:5432, databases `becca` and `becca_test` |

- Log in as `alice`, `bob`, `carol` or `dave`, password `password`.
- Phone: install Expo Go, join the same Wi-Fi as the computer and scan the QR
  code. The Makefile finds the LAN IP with macOS `ipconfig`. If it is wrong or
  missing, run `make dev LAN_IP=192.168.1.20`.
- No `.env` file is needed. An optional root `.env` can override the dev-only
  `JWT_SECRET` and `BOT_SERVICE_TOKEN`. Other settings live in
  `docker-compose.yml`.
- The backend applies migrations to `becca` on every start. Run `make reset`
  after a pull that replaces the migration history.

To open a database shell: `docker exec -it becca-db psql -U postgres -d becca`.

## Test

```sh
make test                         # backend unit and integration, frontend Vitest, mobile check
cd ai && pip install -e ".[dev,train,serve]" && pytest   # Python, on the host (3.11+)
```

The 4-player Playwright game runs in CI on pushes to `main`. CI workflows live
in `.github/workflows/`, one per folder.

### Not in Docker yet

These tasks still need tools installed on the host. Moving them into Docker is
possible future work, not planned now.

- Python tests in `ai/`: need Python 3.11+ (see the command above).
- Playwright end-to-end tests: need Node on the host. See
  [frontend/README.md](./frontend/README.md).
- Native iOS and Android builds: need Xcode or Android Studio. Expo Go testing
  does not. See [mobile/README.md](./mobile/README.md).

## Deploy

- Backend: Render builds `backend/Dockerfile`. The container runs
  `prisma migrate deploy` before it starts the server.
- Database: Neon PostgreSQL.
- Website: Vercel builds `frontend/`. It proxies `/api` and `/socket.io` to
  Render, so the browser uses one origin.
- Bot service: a separate Render service from `ai/render.yaml`, deployed by
  hand. See [ai/docs/DEPLOYMENT.md](./ai/docs/DEPLOYMENT.md).

The backend and website deploy on every push to `main`. Work goes to `develop` first;
a PR from `develop` to `main` releases it. See [RUNBOOK.md](./RUNBOOK.md) for
environment variables, migrations, backups and incidents.

## More

- [CLAUDE.md](./CLAUDE.md): glossary, rules, architecture and conventions.
- [RUNBOOK.md](./RUNBOOK.md): production operations.
- [docs/decisions.md](./docs/decisions.md): design decisions and rejected alternatives.
