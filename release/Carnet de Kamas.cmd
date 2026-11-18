@echo off
rem Starts Carnet de Kamas and opens it in the browser (double-click this file).
rem Keep the window open while using the app; closing it stops the app.
chcp 65001 >nul
cd /d "%~dp0"
title Carnet de Kamas

where node >nul 2>nul
if errorlevel 1 (
  echo Carnet de Kamas a besoin de Node.js, qui n'est pas installé sur cet ordinateur.
  echo Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  start "" "https://nodejs.org/fr/download"
  pause
  exit /b 1
)

node server\main.js --open
if errorlevel 1 pause
