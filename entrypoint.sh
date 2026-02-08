#!/bin/sh
set -eu

MAIN_JS="/app/dist/main.js"

if [ "$#" -eq 0 ]; then
  set -- start
fi

if [ "$1" = "--auth" ]; then
  shift
  set -- auth "$@"
fi

is_cli_command=0
case "$1" in
  auth|start|check-usage|debug)
    is_cli_command=1
    ;;
  -*)
    set -- start "$@"
    is_cli_command=1
    ;;
esac

# Allow overriding the entrypoint with an arbitrary process command.
if [ "$is_cli_command" -eq 0 ]; then
  exec "$@"
fi

if [ "$1" = "start" ] && [ -n "${GH_TOKEN:-}" ]; then
  has_github_token_arg=0
  for arg in "$@"; do
    case "$arg" in
      --github-token|--github-token=*|-g)
        has_github_token_arg=1
        break
        ;;
    esac
  done

  if [ "$has_github_token_arg" -eq 0 ]; then
    set -- "$@" --github-token "$GH_TOKEN"
  fi
fi

exec bun run "$MAIN_JS" "$@"
