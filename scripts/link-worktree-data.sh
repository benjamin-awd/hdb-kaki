#!/usr/bin/env bash
# WorktreeCreate hook.
#
# A WorktreeCreate hook *replaces* Claude Code's default `git worktree` logic, so
# this script owns the whole job: create the worktree Claude Code asked for,
# symlink the gitignored generated data into it (so the web app renders real
# data), then echo the worktree path to stdout.
#
# Contract (from the `claude --worktree` error and the docs' SVN example):
#   - stdin is a JSON payload with, among others, `worktree_path`.
#   - stdout must contain ONLY the created worktree's absolute path; Claude Code
#     uses it as the session's working directory. Send everything else to stderr.
#   - Any non-zero exit fails worktree creation.
set -euo pipefail

log() { printf 'link-worktree-data: %s\n' "$*" >&2; }

MAIN="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

payload="$(cat)"

# Claude Code picks the path (default: .claude/worktrees/<name>). Fall back to a
# name field if it is ever absent, so the hook still produces a usable path.
WT="$(printf '%s' "$payload" | jq -r '.worktree_path // empty')"
if [ -z "$WT" ]; then
  NAME="$(printf '%s' "$payload" | jq -r '.name // .worktree_reason // empty')"
  [ -n "$NAME" ] || { log "no worktree_path or name in payload: $payload"; exit 1; }
  WT="$MAIN/.claude/worktrees/$NAME"
fi

BRANCH="worktree-$(basename "$WT")"

# Create the worktree unless the path already exists (reuse an existing one).
if [ ! -e "$WT" ]; then
  BASE="$(git -C "$MAIN" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  BASE="${BASE#refs/remotes/}"
  [ -n "$BASE" ] || BASE="$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)"

  mkdir -p "$(dirname "$WT")"
  if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    log "adding worktree $WT on existing branch $BRANCH"
    git -C "$MAIN" worktree add "$WT" "$BRANCH" >&2
  else
    log "adding worktree $WT on new branch $BRANCH from $BASE"
    git -C "$MAIN" worktree add "$WT" -b "$BRANCH" "$BASE" >&2
  fi
fi

# Symlink gitignored paths from the main checkout so each worktree behaves like it:
#   web/public/data, web/public/duckdb — generated data, so the web app renders real data
#   web/.dev.vars                       — OneMap creds for build_food.py's geocoding, so it can
#                                         be run from any worktree without re-entering them
#   .claude/skills                      — project-scoped skills (e.g. /impeccable) resolve;
#                                         gitignored, so a fresh worktree would otherwise omit them
# Each source is optional: skipped if the main checkout doesn't have it yet.
for rel in web/public/data web/public/duckdb web/.dev.vars .claude/skills; do
  src="$MAIN/$rel"
  dst="$WT/$rel"
  [ -e "$src" ] || continue      # source not present yet; skip
  [ -e "$dst" ] && continue      # already present in the worktree
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  log "linked $rel"
done

# Echo ONLY the worktree path to stdout.
printf '%s\n' "$WT"
