# Local development. Needs only Docker and make. The phone uses the Mac's LAN IP;
# override with `make dev LAN_IP=192.168.1.20`.
LAN_IP ?= $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
export LAN_IP

.DEFAULT_GOAL := help
.PHONY: help dev stop reset logs test qr

help: ## Show this help
	@awk -F':.*## ' '/^[a-z]+:.*## /{printf "  make %-6s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Build and start everything in the background, then print the URLs
	docker compose up --build --detach --wait
	@echo "Web      http://localhost:8081  (users alice, bob, carol, dave; password: password)"
	@echo "API      http://localhost:8000  http://$(LAN_IP):8000"
	@echo "Bot      http://localhost:8011/health"
	@echo "Adminer  http://localhost:8080  (server db, user postgres, password postgres)"
	@$(MAKE) --no-print-directory qr

qr: ## Print the Expo Go URL and QR code for the phone
	@echo "Expo Go  exp://$(LAN_IP):8082"
	-@docker compose exec mobile node -e "require('@expo/cli/build/src/utils/qr').printQRCode('exp://$(LAN_IP):8082').print()"

stop: ## Stop all containers, keep data
	docker compose down

reset: ## Delete the database and node_modules volumes, then start fresh
	docker compose down --volumes
	$(MAKE) dev

logs: ## Follow the logs of all services
	docker compose logs --follow

test: ## Run backend, frontend and mobile tests inside the containers
	docker compose up --detach --wait
	docker run --rm --network container:becca-db --volumes-from becca-backend \
		--volume "$(CURDIR)/ai:/ai:ro" --workdir /app \
		node:24-alpine3.21 sh -c "npm run db:test:prepare && npm test -- --testTimeout=20000"
	docker compose exec frontend npm test
	docker compose exec mobile npm run check -- --testTimeout=20000
