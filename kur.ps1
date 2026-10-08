# Claude Code status line kurulumu (oh-my-posh + node gerekir)
$ErrorActionPreference = 'Stop'
$src    = $PSScriptRoot
$claude = Join-Path $env:USERPROFILE '.claude'
$dest   = Join-Path $claude 'statusline'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js yok -> winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
}
if (-not (Get-Command oh-my-posh -ErrorAction SilentlyContinue)) {
  Write-Host 'oh-my-posh kuruluyor...' -ForegroundColor Cyan
  winget install JanDeDobbeleer.OhMyPosh -s winget --accept-package-agreements --accept-source-agreements
}

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $src 'statusline.mjs'), (Join-Path $src 'claude.omp.json') $dest -Force

# settings.json'a statusLine ekle (diger ayarlara dokunmadan)
$settingsPath = Join-Path $claude 'settings.json'
if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.bak-statusline" -Force
  $s = Get-Content $settingsPath -Raw | ConvertFrom-Json
} else {
  $s = New-Object PSObject
}
$cmd = 'node ' + ((Join-Path $dest 'statusline.mjs') -replace '\','/')
$sl  = [PSCustomObject]@{ type = 'command'; command = $cmd }
$s | Add-Member -NotePropertyName statusLine -NotePropertyValue $sl -Force
[IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 50), (New-Object Text.UTF8Encoding $false))

Write-Host "Tamam. statusLine -> $cmd" -ForegroundColor Green
Write-Host 'Ikonlar kare gorunurse: oh-my-posh font install meslo  -> terminal fontunu "MesloLGM Nerd Font" yap' -ForegroundColor Yellow
