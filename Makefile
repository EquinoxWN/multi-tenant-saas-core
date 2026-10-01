.PHONY: setup lint test build migrate bench ci audit

setup:
	npm ci

lint:
	npm run lint

build:
	npm run build

# Unit, row-level-security and HTTP tests against a real PostgreSQL (embedded-postgres, or TEST_DATABASE_URL).
test:
	npm test

# Apply migrations to DATABASE_ADMIN_URL.
migrate: build
	npm run migrate

bench:
	@echo "M3: noisy-neighbour load test"

# Known vulnerabilities in npm dependencies (high and critical fail).
audit:
	npm audit --audit-level=high

ci: setup lint test
