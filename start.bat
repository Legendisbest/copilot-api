@echo off
echo ================================================
echo GitHub Copilot API Server
echo ================================================
echo.

if not exist node_modules (
    echo Installing dependencies...
    bun install
    echo.
)

echo Starting server...
echo Opening local usage endpoint in your browser...
echo Dashboard URL: http://localhost:8080/dashboard
echo.

start "" "http://localhost:8080/usage-viewer?endpoint=http://localhost:8080/usage"
bun run dev

pause
