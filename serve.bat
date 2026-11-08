@echo off
cd /d "%~dp0"
echo Bubble Diagram at http://127.0.0.1:8770
start "" http://127.0.0.1:8770
python -m http.server 8770 --bind 127.0.0.1
