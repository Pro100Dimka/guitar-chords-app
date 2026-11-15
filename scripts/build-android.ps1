param(
    [ValidateSet('arm64-v8a', 'armeabi-v7a', 'both')]
    [string]$Abi = 'arm64-v8a',
    [string]$CacheDirectory = 'E:\CodexTemp\freetune-build',
    [switch]$TestSigning
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$android = Join-Path $repo 'android'
$link = Join-Path $android '.release-output'
$cache = [IO.Path]::GetFullPath($CacheDirectory)
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (Test-Path -LiteralPath $link) {
    $existing = Get-Item -LiteralPath $link -Force
    if ($existing.LinkType -ne 'Junction') { throw "$link must be a build-output junction" }
    $build = $existing.Target
} else {
    $build = Join-Path $cache 'app-build'
    New-Item -ItemType Directory -Force -Path $build | Out-Null
    New-Item -ItemType Junction -Path $link -Target $build | Out-Null
}
$variables = @{
    TEMP = Join-Path $cache 'temp'
    TMP = Join-Path $cache 'temp'
    NODE_COMPILE_CACHE = Join-Path $cache 'node-compile-cache'
}
if (-not $env:GRADLE_USER_HOME) {
    $variables.GRADLE_USER_HOME = if (Test-Path 'E:\GradleCache') { 'E:\GradleCache' } else { Join-Path $cache 'gradle' }
}
if ($TestSigning) {
    $variables.RELEASE_STORE_FILE = Join-Path $android 'app\debug.keystore'
    $variables.RELEASE_STORE_PASSWORD = 'android'
    $variables.RELEASE_KEY_ALIAS = 'androiddebugkey'
    $variables.RELEASE_KEY_PASSWORD = 'android'
} elseif (-not $env:RELEASE_STORE_FILE) {
    throw 'Configure RELEASE_STORE_FILE and signing credentials, or pass -TestSigning for a local test APK'
}
$previous = @{}
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
    foreach ($name in $variables.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process')
    }
    New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
    $architectures = @{ 'arm64-v8a' = 'arm64-v8a'; 'armeabi-v7a' = 'armeabi-v7a'; both = 'armeabi-v7a,arm64-v8a' }[$Abi]
    Push-Location $android
    try {
        & .\gradlew.bat :app:assembleRelease '-PsplitApks=true' "-PreactNativeArchitectures=$architectures" "-PfreetuneBuildDirectory=$build" --console=plain
        if ($LASTEXITCODE -ne 0) { throw "Gradle failed: $LASTEXITCODE" }
    } finally { Pop-Location }
    $output = Join-Path $build 'outputs\apk\release'
    $metadata = Get-Content -LiteralPath (Join-Path $output 'output-metadata.json') -Raw | ConvertFrom-Json
    if ($metadata.applicationId -ne 'com.freetune') { throw 'Unexpected application ID' }
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
    $tools = Join-Path $sdk 'build-tools\36.0.0'
    foreach ($entry in $metadata.elements) {
        $apk = Join-Path $output $entry.outputFile
        if ((Get-Item -LiteralPath $apk).Length -gt 40000000) { throw "APK exceeds 40 MB: $apk" }
        & (Join-Path $tools 'apksigner.bat') verify $apk
        if ($LASTEXITCODE -ne 0) { throw "Invalid APK signature: $apk" }
        & (Join-Path $tools 'zipalign.exe') -c -P 16 4 $apk
        if ($LASTEXITCODE -ne 0) { throw "Invalid APK alignment: $apk" }
        Write-Output $apk
    }
    $timer.Stop()
    Write-Output ('Build and package checks: {0:N1} seconds' -f $timer.Elapsed.TotalSeconds)
} finally {
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
