param(
    [switch]$CheckWebView2,
    [switch]$InstallWebView2
)

$ErrorActionPreference = 'Stop'

$runtimeId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$runtimeKeys = @(
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\$runtimeId",
    "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeId",
    "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeId"
)

function Test-WebView2Runtime {
    foreach ($runtimeKey in $runtimeKeys) {
        try {
            $versionText = (Get-ItemProperty -LiteralPath $runtimeKey -Name pv -ErrorAction Stop).pv
            $version = [version]::Parse([string]$versionText)
            if ($version -gt [version]'0.0.0.0') { return $true }
        } catch { }
    }
    return $false
}

if ($CheckWebView2) {
    if (Test-WebView2Runtime) { exit 0 }
    exit 1
}

if (-not $InstallWebView2) {
    throw 'Choose either -CheckWebView2 or -InstallWebView2.'
}
if (Test-WebView2Runtime) { exit 0 }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$installerPath = Join-Path $env:TEMP ("qingzhang-webview2-" + [guid]::NewGuid().ToString() + '.exe')
try {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installerPath -UseBasicParsing
    $signature = Get-AuthenticodeSignature -FilePath $installerPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
        throw 'The downloaded WebView2 installer signature could not be verified as Microsoft Corporation.'
    }

    $process = Start-Process -FilePath $installerPath -ArgumentList '/silent /install' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        throw "The WebView2 installer returned exit code $($process.ExitCode)."
    }

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-WebView2Runtime) { exit 0 }
        Start-Sleep -Seconds 1
    }
    throw 'The WebView2 Runtime was not detected after installation.'
} finally {
    if (Test-Path -LiteralPath $installerPath) {
        Remove-Item -LiteralPath $installerPath -Force
    }
}
