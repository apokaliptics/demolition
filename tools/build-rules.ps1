param(
    [string]$ListsDir = "rules/lists",
    [int]$MaxStaticRules = 30000,
    [switch]$UseAdblockBridge
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$compilerDir = Join-Path $repoRoot "tools/filter-compiler-rs"
$listsPath = Join-Path $repoRoot $ListsDir
$rulesDir = Join-Path $repoRoot "rules"

New-Item -ItemType Directory -Force -Path $listsPath | Out-Null
New-Item -ItemType Directory -Force -Path $rulesDir | Out-Null

$networkList = Join-Path $listsPath "easylist.txt"
$privacyList = Join-Path $listsPath "easyprivacy.txt"

Write-Host "Downloading EasyList..."
Invoke-WebRequest -Uri "https://easylist.to/easylist/easylist.txt" -OutFile $networkList

Write-Host "Downloading EasyPrivacy..."
Invoke-WebRequest -Uri "https://easylist.to/easylist/easyprivacy.txt" -OutFile $privacyList

$featureArgs = @()
$parserArgs = @("--parser-mode", "native")
if ($UseAdblockBridge) {
    $featureArgs = @("--features", "adblock-bridge")
    $parserArgs = @("--parser-mode", "adblock")
}

$networkOutput = Join-Path $rulesDir "core-network.json"
$networkOverflow = Join-Path $rulesDir "core-network.overflow.json"
$privacyOutput = Join-Path $rulesDir "core-privacy.json"
$privacyOverflow = Join-Path $rulesDir "core-privacy.overflow.json"

Push-Location $compilerDir
try {
    Write-Host "Compiling network rules -> rules/core-network.json"
    cargo run @featureArgs -- `
        --input $networkList `
        --output $networkOutput `
        --max-static-rules $MaxStaticRules `
        --start-id 1 `
        @parserArgs `
        --overflow-output $networkOverflow `
        --overflow-chunk-size 5000

    Write-Host "Compiling privacy rules -> rules/core-privacy.json"
    cargo run @featureArgs -- `
        --input $privacyList `
        --output $privacyOutput `
        --max-static-rules $MaxStaticRules `
        --start-id 1 `
        @parserArgs `
        --overflow-output $privacyOverflow `
        --overflow-chunk-size 5000
}
finally {
    Pop-Location
}

Write-Host "Done. Reload the extension at chrome://extensions to apply updated static rules."
