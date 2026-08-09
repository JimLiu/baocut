[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CliArgs
)

$ErrorActionPreference = "Stop"
$requiredSpec = ">=1.14,<2.0"
$skillRoot = Split-Path -Parent $PSScriptRoot
$skillMarkdown = Join-Path $skillRoot "SKILL.md"
$publicRepository = "JimLiu/baocut"
$releaseApi = "https://api.github.com/repos/$publicRepository/releases?per_page=20"

function Get-SkillMetadataValue([string] $Name) {
    $pattern = "^\s*$([regex]::Escape($Name)):\s*[`"']?([^`"'\s]+)[`"']?\s*$"
    foreach ($line in Get-Content -LiteralPath $skillMarkdown) {
        if ($line -match $pattern) { return $Matches[1] }
    }
    throw "BaoCut skill metadata is incomplete; reinstall the baocut skill."
}

function Test-VersionAtLeast([string] $Current, [string] $Minimum) {
    try { return [version]$Current -ge [version]$Minimum } catch { return $false }
}

function Invoke-BaoCutHandshake([string] $Executable) {
    $env:BAOCUT_SKILL_VERSION = $skillVersion
    $env:BAOCUT_SKILL_MIN_APP = $minimumAppVersion
    $raw = & $Executable --require-spec $requiredSpec --json version
    if ($LASTEXITCODE -ne 0) { throw "BaoCut CLI compatibility handshake failed (exit $LASTEXITCODE)." }
    $version = $raw | ConvertFrom-Json
    if (-not $version.appVersion) { throw "This BaoCut CLI predates the skill handshake." }
    if (-not (Test-VersionAtLeast ([string]$version.appVersion) $minimumAppVersion)) {
        throw "BaoCut skill v$skillVersion requires BaoCut App >= $minimumAppVersion; found $($version.appVersion)."
    }
}

function Resolve-Override {
    foreach ($name in "BAOCUT_CLI", "BCUT_EXECUTABLE", "BAOCUT_BIN") {
        $candidate = [Environment]::GetEnvironmentVariable($name)
        if ($candidate) {
            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                throw "$name points to a missing BaoCut CLI: $candidate"
            }
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Resolve-DevelopmentCli {
    if ($env:BAOCUT_SKILL_NO_DEV -eq "1") { return $null }
    $directory = Get-Item -LiteralPath $skillRoot
    while ($directory) {
        if ((Test-Path (Join-Path $directory.FullName "core\Cargo.toml")) -and
            (Test-Path (Join-Path $directory.FullName "apps\cli"))) {
            $release = Join-Path $directory.FullName "core\target\release\bcut.exe"
            $debug = Join-Path $directory.FullName "core\target\debug\bcut.exe"
            $candidate = $null
            if ((Test-Path $debug) -and
                ((-not (Test-Path $release)) -or
                 ((Get-Item $debug).LastWriteTimeUtc -gt (Get-Item $release).LastWriteTimeUtc))) {
                $candidate = $debug
                Write-Warning "Using debug build; transcription will be much slower. Build the release CLI first."
            } elseif (Test-Path $release) {
                $candidate = $release
            }
            if ($candidate) {
                Write-Verbose "BaoCut development checkout detected at $($directory.FullName)"
                return (Resolve-Path -LiteralPath $candidate).Path
            }
            return $null
        }
        $directory = $directory.Parent
    }
    return $null
}

function Resolve-CachedCli {
    $cacheRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath("LocalApplicationData") }
    if (-not $cacheRoot) { return $null }
    $cliRoot = Join-Path $cacheRoot "BaoCut\cli"
    if (-not (Test-Path -LiteralPath $cliRoot -PathType Container)) { return $null }

    $candidates = Get-ChildItem -LiteralPath $cliRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.Name -match '^(?<Version>\d+\.\d+\.\d+)-build\.(?<Build>\d+)$') {
                $executable = Join-Path $_.FullName "bcut.exe"
                if (Test-Path -LiteralPath $executable -PathType Leaf) {
                    [pscustomobject]@{
                        Version = [version]$Matches.Version
                        Build = [int64]$Matches.Build
                        Executable = $executable
                    }
                }
            }
        } | Sort-Object -Property @{ Expression = "Version"; Descending = $true },
            @{ Expression = "Build"; Descending = $true }

    foreach ($candidate in $candidates) {
        try {
            Invoke-BaoCutHandshake $candidate.Executable
            Write-Verbose "Using compatible cached BaoCut CLI $($candidate.Version)-build.$($candidate.Build)"
            return $candidate.Executable
        } catch {
            Write-Verbose "Ignoring incompatible cached BaoCut CLI $($candidate.Executable): $_"
        }
    }
    return $null
}

function Get-LatestWindowsRelease {
    $headers = @{ Accept = "application/vnd.github+json"; "User-Agent" = "baocut-skill/$skillVersion" }
    $releases = Invoke-RestMethod -Uri $releaseApi -Headers $headers
    foreach ($release in $releases) {
        if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^baocut-v\d+\.\d+\.\d+-build\.\d+$') { continue }
        $manifestAsset = $release.assets | Where-Object name -eq "windows-cli-release.json" | Select-Object -First 1
        if (-not $manifestAsset) { continue }
        $manifest = Invoke-RestMethod -Uri $manifestAsset.browser_download_url -Headers $headers
        $target = $manifest.targets.'x86_64-pc-windows-msvc'
        if ($manifest.schema -eq 1 -and $target.supportTier -eq "stable" -and $target.entry -eq "bcut.exe") {
            return @{ Release = $release; Manifest = $manifest; Target = $target; Headers = $headers }
        }
    }
    throw "No published BaoCut release with a Windows x64 CLI was found at https://github.com/$publicRepository/releases."
}

function Install-LatestWindowsCli {
    if ($env:BAOCUT_SKILL_NO_DOWNLOAD -eq "1") {
        throw "BaoCut CLI was not found and BAOCUT_SKILL_NO_DOWNLOAD=1 disables automatic installation."
    }
    $resolved = Get-LatestWindowsRelease
    $manifest = $resolved.Manifest
    $target = $resolved.Target
    $archiveName = [string]$target.cli.file
    if ($archiveName -notmatch '^bcut-[0-9.]+-build\.\d+-x86_64-pc-windows-msvc\.zip$' -or
        [string]$target.cli.sha256 -notmatch '^[0-9a-f]{64}$') {
        throw "The Windows CLI release manifest has an invalid archive record."
    }
    $archiveAsset = $resolved.Release.assets | Where-Object name -eq $archiveName | Select-Object -First 1
    if (-not $archiveAsset) { throw "Release asset is missing: $archiveName" }

    $cacheRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath("LocalApplicationData") }
    if (-not $cacheRoot) { throw "Windows LocalApplicationData directory is unavailable." }
    $cacheDirectory = Join-Path $cacheRoot "BaoCut\cli\$($manifest.version)-build.$($manifest.build)"
    $cacheExecutable = Join-Path $cacheDirectory "bcut.exe"
    if (Test-Path -LiteralPath $cacheExecutable -PathType Leaf) { return $cacheExecutable }

    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    $temporaryArchive = Join-Path $cacheDirectory ".bcut-download-$PID.zip"
    $temporaryDirectory = Join-Path $cacheDirectory ".bcut-extract-$PID"
    try {
        Write-Verbose "Downloading BaoCut CLI $($manifest.version) (build $($manifest.build)) from $($archiveAsset.browser_download_url)"
        Invoke-WebRequest -Uri $archiveAsset.browser_download_url -Headers $resolved.Headers -OutFile $temporaryArchive
        $actualHash = (Get-FileHash -LiteralPath $temporaryArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne [string]$target.cli.sha256) {
            throw "SHA-256 mismatch for $archiveName; the download was deleted."
        }
        Expand-Archive -LiteralPath $temporaryArchive -DestinationPath $temporaryDirectory
        $extracted = Join-Path $temporaryDirectory "bcut.exe"
        if (-not (Test-Path -LiteralPath $extracted -PathType Leaf)) { throw "The archive has no bcut.exe entry." }
        Move-Item -LiteralPath $extracted -Destination $cacheExecutable -Force
    } finally {
        Remove-Item -LiteralPath $temporaryArchive -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    return $cacheExecutable
}

try {
    $skillVersion = Get-SkillMetadataValue "version"
    $minimumAppVersion = Get-SkillMetadataValue "minAppVersion"
    $cli = Resolve-Override
    $intentionalSource = [bool]$cli
    if (-not $cli) {
        $cli = Resolve-DevelopmentCli
        $intentionalSource = [bool]$cli
    }
    if (-not $cli) {
        $pathCommand = Get-Command bcut.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($pathCommand) { $cli = $pathCommand.Source }
    }

    if ($cli) {
        try { Invoke-BaoCutHandshake $cli } catch {
            if ($intentionalSource) { throw }
            Write-Verbose $_
            $cli = $null
        }
    }
    if (-not $cli) {
        $cli = Resolve-CachedCli
    }
    if (-not $cli) {
        $cli = Install-LatestWindowsCli
        Invoke-BaoCutHandshake $cli
    }

    $env:BAOCUT_SKILL_VERSION = $skillVersion
    $env:BAOCUT_SKILL_MIN_APP = $minimumAppVersion
    & $cli --require-spec $requiredSpec @CliArgs
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 3
}
