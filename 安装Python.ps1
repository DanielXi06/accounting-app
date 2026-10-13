$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$nativeArchitecture = $env:PROCESSOR_ARCHITEW6432
if (-not $nativeArchitecture) { $nativeArchitecture = $env:PROCESSOR_ARCHITECTURE }
if ($nativeArchitecture -eq 'ARM64') {
    $installerArchitecture = 'arm64'
} elseif ($nativeArchitecture -eq 'x86') {
    $installerArchitecture = 'win32'
} else {
    $installerArchitecture = 'amd64'
}

$releasePage = Invoke-WebRequest -Uri 'https://www.python.org/downloads/windows/' -UseBasicParsing
$pattern = 'https://www\.python\.org/ftp/python/[\d.]+/python-[\d.]+-' + $installerArchitecture + '\.exe'
$installerUrl = [regex]::Match($releasePage.Content, $pattern).Value
if (-not $installerUrl) {
    throw "No current Python installer was found for architecture $installerArchitecture."
}
$versionMatch = [regex]::Match($installerUrl, '/ftp/python/(?<version>\d+\.\d+(?:\.\d+)?)/')
if (-not $versionMatch.Success) {
    throw 'Could not determine the Python installer version from its official download URL.'
}
$versionParts = $versionMatch.Groups['version'].Value.Split('.')
$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
    throw "The official download page selected Python $major.$minor; version 3.10 or newer is required."
}
$pythonInstallDir = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs\Python') ("Python$major$minor")
$pythonExe = Join-Path $pythonInstallDir 'python.exe'

$installerPath = Join-Path $env:TEMP ("qingzhang-python-" + [guid]::NewGuid().ToString() + '.exe')
try {
    Write-Host "Downloading the official Python installer ($installerArchitecture)..."
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

    $signature = Get-AuthenticodeSignature -FilePath $installerPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        throw 'The downloaded installer signature could not be verified as Python Software Foundation.'
    }

    Write-Host "Installing Python $major.$minor for the current Windows user..."
    $targetDirArgument = 'TargetDir="' + $pythonInstallDir + '"'
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/quiet', 'InstallAllUsers=0', $targetDirArgument, 'PrependPath=0', 'Include_launcher=0', 'Include_test=0', 'Include_exe=1', 'Include_pip=1') -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "The Python installer returned exit code $($process.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
        throw "The installer returned success, but python.exe was not created at $pythonInstallDir."
    }
    $installedVersion = & $pythonExe -c "import sys; print('%s.%s' % (sys.version_info.major, sys.version_info.minor))" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'python.exe was created but could not be started.'
    }
    $installedVersionParts = ([string]$installedVersion).Trim().Split('.')
    if ($installedVersionParts.Count -lt 2 -or [int]$installedVersionParts[0] -lt 3 -or ([int]$installedVersionParts[0] -eq 3 -and [int]$installedVersionParts[1] -lt 10)) {
        throw "The installed interpreter reports unsupported version '$installedVersion'."
    }
    Write-Host "Python $installedVersion is installed and verified at $pythonExe."
} finally {
    if (Test-Path -LiteralPath $installerPath) {
        Remove-Item -LiteralPath $installerPath -Force
    }
}
