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

$installerPath = Join-Path $env:TEMP ("qingzhang-python-" + [guid]::NewGuid().ToString() + '.exe')
try {
    Write-Host "Downloading the official Python installer ($installerArchitecture)..."
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

    $signature = Get-AuthenticodeSignature -FilePath $installerPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        throw 'The downloaded installer signature could not be verified as Python Software Foundation.'
    }

    Write-Host 'Installing Python for the current Windows user...'
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0') -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "The Python installer returned exit code $($process.ExitCode)."
    }
    Write-Host 'Python installation completed.'
} finally {
    if (Test-Path -LiteralPath $installerPath) {
        Remove-Item -LiteralPath $installerPath -Force
    }
}
