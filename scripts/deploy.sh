#!/bin/bash
# =============================================================================
# RootVine — Deploy Script (rootvine.ai static site)
# =============================================================================
# Usage: run as the `rootvine` user, NEVER as root (Deploy Playbook,
# non-negotiable #1; workspace CLAUDE.md rule 9):
#
#   su - rootvine -c "bash ~/repos/rootvine-mcp/scripts/deploy.sh"
#
# Why not root, when ShroudedOrangutan and PennyBlack run as root: running as
# root needs `sudo -u` wrappers on every git call, and BeatsVine removed exactly
# those wrappers after the sudoers config broke production three times in one
# day (2026-05-16). As the service user there is nothing to wrap and no
# ownership to repair afterwards.
#
# What it deploys: the contents of site/ (llms.txt, index.html) into
# ~/htdocs/www.rootvine.ai. Nothing is built.
#
# What it does NOT deploy: the npm package. That ships with `npm publish` —
# see Obsidian: Standards/Publishing RootVine to npm.
#
#   1. Preflight: refuse root, confirm the repo is on main with a clean tree
#   2. Pull latest (fast-forward only — this box never makes commits)
#   3. Confirm the site files exist BEFORE touching the live directory
#   4. Copy site/ into htdocs
#   5. Check the live site from this box: status codes, content types, and
#      that the llms.txt being served is byte-for-byte the one in the repo
#
# Never rolls back: for two static files, the previous version is one
# `git checkout` away, and an automatic rollback can restore something worse.
# A failed check is the last thing on screen, with the way back printed.
# =============================================================================

# Paths can be overridden from the environment FOR TESTING ONLY. In production
# run it with no variables set and these defaults apply.
SERVICE_USER="${SERVICE_USER:-rootvine}"
REPO_DIR="${REPO_DIR:-/home/rootvine/repos/rootvine-mcp}"
SITE_DIR="${SITE_DIR:-/home/rootvine/htdocs/www.rootvine.ai}"
CHECK_IP="${CHECK_IP:-127.0.0.1}"   # checks hit THIS box's nginx, not whatever DNS says
BRANCH="main"
DOMAIN="www.rootvine.ai"
APEX="rootvine.ai"
TOTAL_STEPS=5

set -e
set -E            # the ERR trap reaches functions and substitutions too
set -o pipefail
# `set -e` alone aborts silently (Playbook lesson 4, 2026-09-19). Say where.
trap 'echo "!! deploy.sh aborted at line $LINENO (exit $?)" >&2' ERR

fail() { echo ""; echo "!! $1" >&2; echo ""; exit 1; }

# The whole script sits inside main() and is only CALLED on the last line.
# Step 2 pulls this very file; bash reads scripts as it runs them, so a pull
# that changes deploy.sh mid-run would otherwise execute a mixture of the old
# and new versions. Wrapping it makes bash parse everything before step 1.
main() {
    echo ""
    echo "========================================="
    echo "  RootVine (rootvine.ai) - Deploy"
    echo "========================================="
    echo ""

    # ── Step 1: Preflight ────────────────────────────────────────────────
    echo "[1/$TOTAL_STEPS] Preflight..."
    if [ "$(id -u)" -eq 0 ]; then
        fail "Refusing to run as root. Run: su - $SERVICE_USER -c \"bash $REPO_DIR/scripts/deploy.sh\""
    fi
    if [ "$(whoami)" != "$SERVICE_USER" ]; then
        fail "Running as '$(whoami)', expected '$SERVICE_USER'."
    fi
    [ -d "$REPO_DIR/.git" ] || fail "No git repo at $REPO_DIR. See the first-time setup in Obsidian: Git Commands."
    [ -d "$SITE_DIR" ]      || fail "Site directory $SITE_DIR does not exist. Is the CloudPanel site set up?"
    cd "$REPO_DIR"
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD)"
    [ "$branch" = "$BRANCH" ] || fail "Repo is on '$branch', not '$BRANCH'."
    if ! git diff --quiet || ! git diff --cached --quiet; then
        fail "The repo has local edits. Nobody should edit files on the server — see 'git status' in $REPO_DIR."
    fi
    echo "  Done."
    echo ""

    # ── Step 2: Pull ─────────────────────────────────────────────────────
    echo "[2/$TOTAL_STEPS] Pulling latest code..."
    local old_head new_head
    old_head="$(git rev-parse --short HEAD)"
    git pull --ff-only --quiet origin "$BRANCH"
    new_head="$(git rev-parse --short HEAD)"
    if [ "$old_head" = "$new_head" ]; then
        echo "  Already up to date at $new_head. Redeploying the same files."
    else
        echo "  $old_head -> $new_head"
    fi
    echo ""

    # ── Step 3: Confirm the files exist before touching anything live ────
    echo "[3/$TOTAL_STEPS] Checking site files..."
    local f
    for f in index.html llms.txt; do
        [ -s "$REPO_DIR/site/$f" ] || fail "site/$f is missing or empty. Nothing has been changed on the live site."
    done
    echo "  Done."
    echo ""

    # ── Step 4: Deploy ───────────────────────────────────────────────────
    # `*` does not match dot-files, so .well-known (SSL certificate renewal)
    # survives the clear-out.
    echo "[4/$TOTAL_STEPS] Deploying site -> $SITE_DIR"
    rm -rf "${SITE_DIR:?}"/*
    cp -r "$REPO_DIR/site/"* "$SITE_DIR/"
    echo "  Done."
    echo ""

    # ── Step 5: Check the live site ──────────────────────────────────────
    echo "[5/$TOTAL_STEPS] Checking the live site..."
    local failures=0
    local resolve=(--resolve "$DOMAIN:443:$CHECK_IP" --resolve "$APEX:443:$CHECK_IP")

    # check <label> <url> <expected status> <expected content-type fragment or ->
    check() {
        local label="$1" url="$2" want_status="$3" want_type="$4" got_status got_type
        got_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${resolve[@]}" "$url" || true)"
        got_type="$(curl -s -o /dev/null -w '%{content_type}' --max-time 15 "${resolve[@]}" "$url" || true)"
        if [ "$got_status" != "$want_status" ]; then
            echo "  FAIL  $label — status $got_status, expected $want_status"
            failures=$((failures + 1))
        elif [ "$want_type" != "-" ] && ! echo "$got_type" | grep -qi "$want_type"; then
            echo "  FAIL  $label — type '$got_type', expected '$want_type'"
            failures=$((failures + 1))
        else
            echo "  ok    $label ($got_status${got_type:+, $got_type})"
        fi
    }

    check "home page"          "https://$DOMAIN/"               200 "text/html"
    check "llms.txt"           "https://$DOMAIN/llms.txt"       200 "text/plain"
    check "llms.txt charset"   "https://$DOMAIN/llms.txt"       200 "charset=utf-8"
    check "apex redirects"     "https://$APEX/"                 301 "-"
    check "unknown page is 404" "https://$DOMAIN/no-such-page-$$" 404 "-"

    # The strongest check: what nginx serves must BE the file in the repo.
    # Catches a wrong document root, a stale copy, or a caching layer.
    local served_sum repo_sum
    served_sum="$(curl -s --max-time 15 "${resolve[@]}" "https://$DOMAIN/llms.txt" | sha256sum | cut -d' ' -f1 || true)"
    repo_sum="$(sha256sum < "$REPO_DIR/site/llms.txt" | cut -d' ' -f1)"
    if [ "$served_sum" = "$repo_sum" ]; then
        echo "  ok    served llms.txt matches the repo byte for byte"
    else
        echo "  FAIL  served llms.txt differs from the repo copy"
        failures=$((failures + 1))
    fi
    echo ""

    if [ "$failures" -gt 0 ]; then
        echo "========================================="
        echo "  !!! $failures CHECK(S) FAILED !!!"
        echo "  The files ARE deployed, but something about the live site is wrong."
        echo "  Read the FAIL lines above. To go back to the previous version:"
        echo "    cd $REPO_DIR && git checkout $old_head -- site/"
        echo "    cp -r $REPO_DIR/site/* $SITE_DIR/"
        echo "    git checkout $BRANCH -- site/"
        echo "========================================="
        echo ""
        exit 1
    fi

    echo "========================================="
    echo "  Deploy complete! ($new_head)"
    echo "  Site:     https://$DOMAIN"
    echo "  llms.txt: https://$DOMAIN/llms.txt"
    echo "========================================="
    echo ""
}

main "$@"
