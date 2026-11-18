#!/bin/sh
# Starts Carnet de Kamas and opens it in the browser.
# macOS: double-click this file (the first time: right-click > Open). Linux: run it from a terminal.
# Keep the window open while using the app; closing it stops the app.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Carnet de Kamas a besoin de Node.js, qui n'est pas installé sur cet ordinateur."
  echo "Installe la version LTS depuis https://nodejs.org puis relance ce fichier."
  exit 1
fi

exec node server/main.js --open
