#!/bin/sh
if [ "$1" = "--auth" ]; then
  # Run auth command
  exec bun run dist/main.js auth
else
  # Run database migrations (non-fatal if no DATABASE_URL)
  if [ -n "$DATABASE_URL" ]; then
    echo "Running database migrations..."
    bun run dist/main.js db:migrate 2>/dev/null || true
  fi
  # Default command
  exec bun run dist/main.js start -g "$GH_TOKEN" "$@"
fi

