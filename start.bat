@echo off
setlocal enabledelayedexpansion
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

set PASS=0
set FAIL=0
set WARN=0

echo.
echo Multi Script Manager - pre-flight checks
echo =========================================

:: Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] Node.js not found. Install from https://nodejs.org
    set /a FAIL+=1
) else (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
    for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set NODE_MAJOR=%%m
    if !NODE_MAJOR! LSS 18 (
        echo   [FAIL] Node.js !NODE_VER! found but ^>=18 required.
        set /a FAIL+=1
    ) else (
        echo   [OK]   Node.js !NODE_VER!
        set /a PASS+=1
    )
)

:: npm
call npm --version >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] npm not found. It normally ships with Node.js.
    set /a FAIL+=1
) else (
    for /f "tokens=*" %%v in ('call npm --version 2^>nul') do set NPM_VER=%%v
    echo   [OK]   npm !NPM_VER!
    set /a PASS+=1
)

:: node_modules
if exist "%DIR%\node_modules\electron" (
    echo   [OK]   node_modules present
    set /a PASS+=1
) else (
    echo   [WARN] node_modules missing - running npm install...
    set /a WARN+=1
    cd /d "%DIR%"
    call npm install
    echo   [OK]   npm install completed
    set /a PASS+=1
)

:: Electron binary
if exist "%DIR%\node_modules\electron\dist\electron.exe" (
    echo   [OK]   Electron binary present
    set /a PASS+=1
) else (
    echo   [WARN] Electron binary missing - attempting to download...
    set /a WARN+=1
    cd /d "%DIR%"
    node "%DIR%\node_modules\electron\install.js" 2>nul
    if exist "%DIR%\node_modules\electron\dist\electron.exe" (
        echo   [OK]   Electron binary ready
        set /a PASS+=1
    ) else (
        echo   [FAIL] Electron binary could not be installed. Try: npm install --force
        set /a FAIL+=1
    )
)

:: Summary
echo.
echo   Passed: %PASS%   Warnings: %WARN%   Failed: %FAIL%
echo.

if %FAIL% GTR 0 (
    echo Fix the above errors before launching.
    pause
    exit /b 1
)

echo Starting Multi Script Manager...
echo.
cd /d "%DIR%"
set ELECTRON_RUN_AS_NODE=
call "%DIR%\node_modules\.bin\electron.cmd" "%DIR%"
