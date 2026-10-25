.PHONY: dev stop

dev:
	docker compose --env-file backend/.env up --build

stop:
	docker compose --env-file backend/.env down
