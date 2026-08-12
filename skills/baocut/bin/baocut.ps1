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

function ConvertTo-WindowsCommandLineArgument([AllowEmptyString()][string] $Value) {
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }

    # ProcessStartInfo.ArgumentList is unavailable in Windows PowerShell 5.1.
    # Quote argv with the CommandLineToArgvW rules so paths, quotes, empty values,
    # and trailing backslashes survive the no-window ProcessStartInfo launch.
    $quoted = [System.Text.StringBuilder]::new()
    [void]$quoted.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            [void]$quoted.Append(('\' * ($backslashes * 2 + 1)))
            [void]$quoted.Append('"')
        } else {
            if ($backslashes -gt 0) { [void]$quoted.Append(('\' * $backslashes)) }
            [void]$quoted.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) { [void]$quoted.Append(('\' * ($backslashes * 2))) }
    [void]$quoted.Append('"')
    return $quoted.ToString()
}

function New-BaoCutProcessStartInfo([string] $Executable, [string[]] $Arguments) {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.Arguments = (($Arguments | ForEach-Object {
        ConvertTo-WindowsCommandLineArgument ([string]$_)
    }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.Path
    return $startInfo
}

function Invoke-BaoCutCapturedProcess([string] $Executable, [string[]] $Arguments) {
    $startInfo = New-BaoCutProcessStartInfo $Executable $Arguments
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Failed to start BaoCut CLI: $Executable" }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout.GetAwaiter().GetResult()
            Stderr = $stderr.GetAwaiter().GetResult()
        }
    } finally {
        $process.Dispose()
    }
}

function Invoke-BaoCutProcess(
    [string] $Executable,
    [string[]] $Arguments,
    [ref] $ExitCode
) {
    $startInfo = New-BaoCutProcessStartInfo $Executable $Arguments
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $startInfo.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Failed to start BaoCut CLI: $Executable" }
        # A no-window child cannot inherit usable console handles from every
        # Codex host. Keep stdout on PowerShell's success pipeline (so callers
        # can still capture JSON), drain stderr concurrently, and forward stdin
        # asynchronously for JSONL cancellation.
        $stderr = $process.StandardError.ReadToEndAsync()
        $stdin = [Console]::OpenStandardInput().CopyToAsync($process.StandardInput.BaseStream)
        $closeInput = [System.Delegate]::CreateDelegate(
            [System.Action], $process.StandardInput, "Close"
        )
        $stdin.GetAwaiter().OnCompleted($closeInput)
        while (($line = $process.StandardOutput.ReadLine()) -ne $null) {
            Write-Output $line
        }
        $process.WaitForExit()
        $stderrText = $stderr.GetAwaiter().GetResult()
        if ($stderrText) { [Console]::Error.Write($stderrText) }
        $process.StandardInput.Close()
        $ExitCode.Value = $process.ExitCode
    } finally {
        $process.Dispose()
    }
}

function Invoke-BaoCutHandshake([string] $Executable) {
    $env:BAOCUT_SKILL_VERSION = $skillVersion
    $env:BAOCUT_SKILL_MIN_APP = $minimumAppVersion
    $result = Invoke-BaoCutCapturedProcess $Executable @(
        "--require-spec", $requiredSpec, "--json", "version"
    )
    if ($result.ExitCode -ne 0) {
        $detail = $result.Stderr.Trim()
        if ($detail) { throw "BaoCut CLI compatibility handshake failed (exit $($result.ExitCode)): $detail" }
        throw "BaoCut CLI compatibility handshake failed (exit $($result.ExitCode))."
    }
    $version = $result.Stdout | ConvertFrom-Json
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

function Test-LongLocalInference {
    $longInference = $CliArgs | Where-Object { $_ -in @("auto", "transcribe") } | Select-Object -First 1
    $introspection = $CliArgs | Where-Object { $_ -in @("spec", "version", "doctor", "-h", "--help") } | Select-Object -First 1
    return [bool]$longInference -and -not [bool]$introspection
}

function Build-DevelopmentReleaseCli([string] $Root, [string] $Release) {
    $cargo = Get-Command cargo.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cargo) { $cargo = Get-Command cargo -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $cargo) {
        throw "An optimized release CLI is required for local transcription, but cargo was not found."
    }
    Write-Warning "Preparing optimized release CLI for local transcription."
    & $cargo.Source build --manifest-path (Join-Path $Root "core\Cargo.toml") -p bcut --locked --release --target-dir (Join-Path $Root "core\target")
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Release -PathType Leaf)) {
        throw "Failed to prepare the optimized BaoCut release CLI."
    }
    return (Resolve-Path -LiteralPath $Release).Path
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
            $debugIsNewest = (Test-Path $debug) -and
                ((-not (Test-Path $release)) -or
                 ((Get-Item $debug).LastWriteTimeUtc -gt (Get-Item $release).LastWriteTimeUtc))
            if ((Test-LongLocalInference) -and $env:BAOCUT_ALLOW_DEBUG_INFERENCE -ne "1" -and
                ($debugIsNewest -or -not (Test-Path $release))) {
                $candidate = Build-DevelopmentReleaseCli $directory.FullName $release
            } elseif ($debugIsNewest) {
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
            return $candidate
        } catch {
            Write-Verbose "Ignoring incompatible cached BaoCut CLI $($candidate.Executable): $_"
        }
    }
    return $null
}

# The handshake only reports the marketing version, so two builds of the same
# version look identical to it. Every comparison that decides which CLI to run
# must therefore carry the build number alongside the version.
function Test-CliNewer($Candidate, $Baseline) {
    if (-not $Baseline) { return $true }
    if ($Candidate.Version -gt $Baseline.Version) { return $true }
    return ($Candidate.Version -eq $Baseline.Version -and $Candidate.Build -gt $Baseline.Build)
}

function Get-LatestWindowsRelease {
    $headers = @{ Accept = "application/vnd.github+json"; "User-Agent" = "baocut-skill/$skillVersion" }
    $releases = Invoke-RestMethod -Uri $releaseApi -Headers $headers -TimeoutSec 30
    # Windows assets are appended to an already-published Mac release, so the
    # API's creation order does not track version/build order. Rank by the tag.
    $ranked = $releases | ForEach-Object {
        if ($_.draft -or $_.prerelease) { return }
        if ($_.tag_name -match '^baocut-v(?<Version>\d+\.\d+\.\d+)-build\.(?<Build>\d+)$') {
            [pscustomobject]@{
                Release = $_
                Version = [version]$Matches.Version
                Build = [int64]$Matches.Build
            }
        }
    } | Sort-Object -Property @{ Expression = "Version"; Descending = $true },
        @{ Expression = "Build"; Descending = $true }

    foreach ($entry in $ranked) {
        $manifestAsset = $entry.Release.assets | Where-Object name -eq "windows-cli-release.json" | Select-Object -First 1
        if (-not $manifestAsset) { continue }
        $manifest = Invoke-RestMethod -Uri $manifestAsset.browser_download_url -Headers $headers -TimeoutSec 30
        $target = $manifest.targets.'x86_64-pc-windows-msvc'
        if ($manifest.schema -ne 1 -or $target.supportTier -ne "stable" -or $target.entry -ne "bcut.exe") { continue }
        # The release tooling copies `version` and `build` straight out of the
        # tag, so they must round-trip. A mismatch means a stray asset, and the
        # cache directory would then lie about which build it holds.
        $manifestTag = "baocut-v$($manifest.version)-build.$($manifest.build)"
        if ($manifestTag -ne [string]$entry.Release.tag_name) {
            Write-Verbose "Skipping $($entry.Release.tag_name): its manifest declares $manifestTag"
            continue
        }
        return [pscustomobject]@{
            Release = $entry.Release
            Manifest = $manifest
            Target = $target
            Headers = $headers
            Version = $entry.Version
            Build = $entry.Build
        }
    }
    throw "No published BaoCut release with a Windows x64 CLI was found at https://github.com/$publicRepository/releases."
}

function Install-LatestWindowsCli($KnownRelease) {
    if ($env:BAOCUT_SKILL_NO_DOWNLOAD -eq "1") {
        throw "BaoCut CLI was not found and BAOCUT_SKILL_NO_DOWNLOAD=1 disables automatic installation."
    }
    $resolved = if ($KnownRelease) { $KnownRelease } else { Get-LatestWindowsRelease }
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
    # Key on version *and* build so a same-version rebuild lands in its own
    # directory instead of being mistaken for the copy already cached.
    $cacheDirectory = Join-Path $cacheRoot "BaoCut\cli\$($manifest.version)-build.$($manifest.build)"
    $cacheExecutable = Join-Path $cacheDirectory "bcut.exe"
    $installed = [pscustomobject]@{
        Version = $resolved.Version
        Build = $resolved.Build
        Executable = $cacheExecutable
    }
    if (Test-Path -LiteralPath $cacheExecutable -PathType Leaf) { return $installed }

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
    return $installed
}

# A cached CLI that passes the handshake normally ends the search, so a rebuild
# published under the same marketing version would never be picked up. Nothing
# local announces such a rebuild — the skill ships no Windows pin and
# `--json version` exposes no build number — so detecting it requires the
# network. Keep that opt-in: unset, this path stays entirely offline.
function Update-CachedCli($Cached) {
    if ($env:BAOCUT_SKILL_CLI_UPDATE_CHECK -ne "1") { return $null }
    if ($env:BAOCUT_SKILL_NO_DOWNLOAD -eq "1") { return $null }
    try {
        $resolved = Get-LatestWindowsRelease
        if (-not (Test-CliNewer $resolved $Cached)) { return $null }
        Write-Verbose "Cached BaoCut CLI $($Cached.Version)-build.$($Cached.Build) is superseded by $($resolved.Version)-build.$($resolved.Build)"
        $installed = Install-LatestWindowsCli $resolved
        Invoke-BaoCutHandshake $installed.Executable
        return $installed
    } catch {
        # An update check must never break an otherwise working cached CLI.
        Write-Verbose "Keeping the cached BaoCut CLI; update check failed: $_"
        return $null
    }
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
        $cached = Resolve-CachedCli
        if ($cached) {
            $upgraded = Update-CachedCli $cached
            if ($upgraded) { $cached = $upgraded }
            $cli = $cached.Executable
        }
    }
    if (-not $cli) {
        $cli = (Install-LatestWindowsCli).Executable
        Invoke-BaoCutHandshake $cli
    }

    $env:BAOCUT_SKILL_VERSION = $skillVersion
    $env:BAOCUT_SKILL_MIN_APP = $minimumAppVersion
    $exitCode = 3
    Invoke-BaoCutProcess $cli (@("--require-spec", $requiredSpec) + $CliArgs) ([ref]$exitCode)
    exit $exitCode
} catch {
    Write-Error $_
    exit 3
}
