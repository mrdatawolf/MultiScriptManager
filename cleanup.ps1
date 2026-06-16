#Requires -Version 5.1

$DIR = $PSScriptRoot
$full = $args -contains '--full'

Write-Host ""
Write-Host "Multi Script Manager — cleanup"
Write-Host "==============================="

function Remove-IfExists($name) {
    $path = Join-Path $DIR $name
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        Write-Host "  Removed: $name"
    }
}

Remove-IfExists "bin"
Remove-IfExists "electron-dist"
Remove-IfExists "dist"
Remove-IfExists "out"

if ($full) {
    Remove-IfExists "node_modules"
    Write-Host ""
    Write-Host "  Full cleanup done. Run start.ps1 to reinstall dependencies."
} else {
    Write-Host ""
    Write-Host "  Done. Pass --full to also remove node_modules."
}

Write-Host ""
