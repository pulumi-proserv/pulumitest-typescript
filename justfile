# Default recipe - show help
default:
    @just --list

# Run all tests
test:
    npm test

# Run linter and type checker
lint:
    npm run typecheck
    npm run lint

# Auto-fix lint issues
lint-fix:
    npm run lint:fix

# Build the package to dist/
build:
    npm run build

# Install development dependencies
install:
    npm ci

# Install git hooks (pre-push)
install-hooks:
    @echo "Installing git hooks..."
    cp scripts/hooks/pre-push .git/hooks/pre-push
    chmod +x .git/hooks/pre-push
    @echo "Git hooks installed"

# Clean build artifacts
clean:
    rm -rf dist/ *.tgz
