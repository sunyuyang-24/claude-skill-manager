@echo off
cd /d "%~dp0"

REM Check if electron is installed, if not, install it
if not exist "node_modules\electron" (
    echo Installing Electron (one-time setup)...
    call npm install
    echo.
)

REM Check if running from source or installed globally
if exist "node_modules\.bin\electron.cmd" (
    npx electron .
) else (
    REM Fallback to browser mode
    node skill-manager.js
)
pause
