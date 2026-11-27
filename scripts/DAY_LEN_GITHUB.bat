@echo off
chcp 65001 >nul
cd /d "%~dp0.."
python scripts\publish_to_github.py
pause
