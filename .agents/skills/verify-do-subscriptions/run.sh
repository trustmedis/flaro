#!/usr/bin/env bash
# Run the TLC model check for the application DO subscription model.
# Needs a JDK on PATH (or JAVA_HOME). Downloads tla2tools.jar to
# ~/.cache/tla2tools on first run; override with TLA2TOOLS_JAR.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

JAR="${TLA2TOOLS_JAR:-$HOME/.cache/tla2tools/tla2tools.jar}"
if [ ! -f "$JAR" ]; then
  mkdir -p "$(dirname "$JAR")"
  curl -fsSL --retry 2 -o "$JAR" \
    "https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
fi

java_bin="java"
if ! command -v java >/dev/null 2>&1; then
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    java_bin="$JAVA_HOME/bin/java"
  else
    echo "error: no java found. Install a JDK (e.g. 'mise use -g java@21') or set JAVA_HOME." >&2
    exit 2
  fi
fi

# TLC drops a scratch states/ dir next to the spec — copy inputs to a temp
# dir so the skill directory stays clean.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$HERE/ApplicationDO.tla" "$HERE/ApplicationDO.cfg" "$WORK/"
cd "$WORK"
"$java_bin" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto \
  -config ApplicationDO.cfg ApplicationDO.tla
