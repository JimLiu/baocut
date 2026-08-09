[CmdletBinding()]
param(
    [ValidateSet("Plan", "Install")]
    [string]$Mode = "Plan",
    [switch]$Confirmed,
    [string]$BaoCutScript,
    [string]$WingetExecutable
)

$ErrorActionPreference = "Stop"
$baocut = if ($BaoCutScript) { $BaoCutScript } else { Join-Path $PSScriptRoot "baocut.ps1" }

function Invoke-UrlDoctor {
    $shell = (Get-Process -Id $PID).Path
    $hadNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $nativePreference = if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference } else { $null }
    try {
        if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        $records = @(& $shell -NoProfile -File $baocut --json doctor --url-only 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference }
    }
    $envelope = $null
    foreach ($record in ($records | Select-Object -Last 20)) {
        try {
            $candidate = ([string]$record).Trim() | ConvertFrom-Json -ErrorAction Stop
            if ($candidate.status) { $envelope = $candidate }
        } catch { }
    }
    if (-not $envelope -or -not $envelope.data) {
        throw "BaoCut doctor did not return a structured data envelope (exit $exitCode)."
    }
    return $envelope
}

function Test-Ready($Data, [string]$Name) {
    return $Data.$Name -and $Data.$Name.status -eq "ok"
}

function Get-PackagePlan($Data) {
    $packages = [System.Collections.Generic.List[string]]::new()
    $ytDlpMissing = -not (Test-Ready $Data "ytDlp")
    $mediaToolsMissing = -not (Test-Ready $Data "ffmpeg") -or -not (Test-Ready $Data "ffprobe")
    $denoMissing = -not (Test-Ready $Data "deno")
    if ($ytDlpMissing) {
        $packages.Add("yt-dlp.yt-dlp")
    } else {
        if ($mediaToolsMissing) { $packages.Add("yt-dlp.FFmpeg") }
        if ($denoMissing) { $packages.Add("DenoLand.Deno") }
    }
    return @($packages)
}

function New-Plan($Envelope) {
    $packages = @(Get-PackagePlan $Envelope.data)
    return [pscustomobject]@{
        schema = 1
        mode = "plan"
        ready = $Envelope.data.urlDownload -ne "unavailable" -and $packages.Count -eq 0
        requiresConfirmation = $packages.Count -gt 0
        packages = $packages
        checks = $Envelope.data
    }
}

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $links = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links" } else { $null }
    $values = @($env:Path, $machine, $user, $links) |
        Where-Object { $_ } |
        ForEach-Object { $_ -split ";" } |
        Where-Object { $_ } |
        Select-Object -Unique
    $env:Path = $values -join ";"
}

function Install-Packages([string[]]$Packages) {
    if (-not $Packages.Count) { return }
    $winget = if ($WingetExecutable) {
        Get-Command $WingetExecutable -ErrorAction SilentlyContinue | Select-Object -First 1
    } else {
        Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $winget) { throw "winget is required to install URL download dependencies." }
    $hadNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $nativePreference = if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference } else { $null }
    try {
        if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        foreach ($package in $Packages) {
            Write-Host "Installing $package..."
            & $winget.Source install --id $package --exact --source winget `
                --accept-package-agreements --accept-source-agreements --disable-interactivity
            Write-Verbose "winget exit code for ${package}: $LASTEXITCODE"
        }
    } finally {
        if ($hadNativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference }
    }
    Refresh-ProcessPath
}

$initial = Invoke-UrlDoctor
$plan = New-Plan $initial
if ($Mode -eq "Plan") {
    $plan | ConvertTo-Json -Depth 10 -Compress
    return
}
if (-not $Confirmed) {
    throw "Install mode requires -Confirmed after the user approves the displayed Plan."
}

Install-Packages $plan.packages
$afterFirstPass = Invoke-UrlDoctor
$remaining = @(Get-PackagePlan $afterFirstPass.data)
if ($remaining.Count -gt 0) {
    # yt-dlp normally installs Deno and FFmpeg transitively. If that did not
    # happen, install only the still-missing packages on this explicit pass.
    if (-not (Test-Ready $afterFirstPass.data "ytDlp")) {
        $remaining = @("yt-dlp.yt-dlp")
    }
    Install-Packages $remaining
}

$final = Invoke-UrlDoctor
$success = $final.status -eq "ok"
[pscustomobject]@{
    schema = 1
    mode = "install"
    ready = $success
    packages = $plan.packages
    checks = $final.data
} | ConvertTo-Json -Depth 10 -Compress
if (-not $success) { exit 3 }
