[CmdletBinding()]
param(
    [string] $NvidiaSmiExecutable
)

$ErrorActionPreference = "Stop"
$minimumComputeCapability = [version]"8.0"
$minimumDriverVersion = [version]"580.0"

function Resolve-NvidiaSmi {
    if ($NvidiaSmiExecutable) {
        if (Test-Path -LiteralPath $NvidiaSmiExecutable -PathType Leaf) {
            return (Resolve-Path -LiteralPath $NvidiaSmiExecutable).Path
        }
        return $null
    }

    $candidates = @()
    if ($env:WINDIR) {
        $candidates += (Join-Path $env:WINDIR "System32\nvidia-smi.exe")
    }
    if ($env:ProgramW6432) {
        $candidates += (Join-Path $env:ProgramW6432 "NVIDIA Corporation\NVSMI\nvidia-smi.exe")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "NVIDIA Corporation\NVSMI\nvidia-smi.exe")
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $command = Get-Command nvidia-smi.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function New-VariantResult([string] $Variant, [string] $Reason, [object[]] $Gpus) {
    return [pscustomobject]@{
        schema = 1
        variant = $Variant
        reason = $Reason
        minimumComputeCapability = $minimumComputeCapability.ToString(2)
        minimumDriverVersion = $minimumDriverVersion.Major.ToString()
        gpus = @($Gpus)
    }
}

$nvidiaSmi = Resolve-NvidiaSmi
if (-not $nvidiaSmi) {
    New-VariantResult "cpu" "nvidia-smi-unavailable" @() | ConvertTo-Json -Depth 5 -Compress
    return
}

try {
    $probeLines = @(& $nvidiaSmi `
        "--query-gpu=name,compute_cap,driver_version" `
        "--format=csv,noheader,nounits" 2>$null)
    $probeExitCode = $LASTEXITCODE
} catch {
    $probeLines = @()
    $probeExitCode = 1
}
if ($probeExitCode -ne 0) {
    New-VariantResult "cpu" "nvidia-smi-query-failed" @() | ConvertTo-Json -Depth 5 -Compress
    return
}

$gpus = [System.Collections.Generic.List[object]]::new()
$hasCompatibleGpu = $false
foreach ($line in $probeLines) {
    $parts = ([string]$line).Split(',')
    if ($parts.Count -lt 3) { continue }
    $name = $parts[0].Trim()
    try {
        $computeCapability = [version]$parts[1].Trim()
        $driverVersion = [version]$parts[2].Trim()
    } catch {
        continue
    }
    $compatible = $computeCapability -ge $minimumComputeCapability -and
        $driverVersion -ge $minimumDriverVersion
    if ($compatible) { $hasCompatibleGpu = $true }
    $gpus.Add([pscustomobject]@{
        name = $name
        computeCapability = $computeCapability.ToString(2)
        driverVersion = $driverVersion.ToString()
        compatible = $compatible
    })
}

if ($hasCompatibleGpu) {
    New-VariantResult "cuda13" "compatible-nvidia-gpu" $gpus.ToArray() |
        ConvertTo-Json -Depth 5 -Compress
} else {
    New-VariantResult "cpu" "no-compatible-nvidia-gpu" $gpus.ToArray() |
        ConvertTo-Json -Depth 5 -Compress
}
