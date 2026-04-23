.PHONY: dev build clean install lint typecheck \
        desktop-dev desktop-build desktop-dist desktop-install desktop-clean

# ── Web / server ──────────────────────────────────────────────────────────────
install:
	npm install

build:
	npm run build

dev:
	node apps/webview/server.mjs

clean:
	find . -name dist -type d -not -path '*/node_modules/*' | xargs rm -rf
	find . -name '*.js' -path '*/src/*' -not -path '*/node_modules/*' | xargs rm -f

lint:
	npx eslint apps/webview/src --ext .ts 2>/dev/null || true

typecheck:
	npm run build

# ── Desktop (Electron) ────────────────────────────────────────────────────────
desktop-install:
	cd apps/desktop && npm install

# Run in dev mode — opens Electron window pointing at embedded server
desktop-dev: build desktop-install
	cd apps/desktop && npx electron .

# Build unpacked app (fast, no installer)
desktop-build: build desktop-install
	cd apps/desktop && npx electron-builder --dir

# Build distributable installers (.deb/.AppImage / .dmg / .exe)
desktop-dist: build desktop-install
	cd apps/desktop && npx electron-builder

desktop-clean:
	rm -rf apps/desktop/node_modules
	rm -rf apps/desktop/dist
