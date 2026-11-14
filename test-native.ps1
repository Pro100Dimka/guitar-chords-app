param(
    [Parameter(Mandatory = $true)][string]$KotlinLib,
    [string]$OutputDirectory = 'E:\CodexTemp\guitar-native-tests',
    [string]$RecorderSource = "$PSScriptRoot/android/app/src/main/java/com/freetune/PerformanceAudio.kt"
)
$ErrorActionPreference = 'Stop'
$KotlinLib = (Resolve-Path -LiteralPath $KotlinLib).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
    $env:TEMP = $OutputDirectory
    $env:TMP = $OutputDirectory
    $standardLibrary = @(Get-ChildItem -LiteralPath $KotlinLib -Filter 'kotlin-stdlib*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib(?:-\d[^/]*)?\.jar$' -and $_.Name -notmatch '-(sources|javadoc)\.jar$' })[0].FullName
    $annotations = @(Get-ChildItem -LiteralPath $KotlinLib -Filter 'annotations-*.jar')[0].FullName
    if (!$standardLibrary -or !$annotations) { throw 'Kotlin runtime or annotations JAR not found' }
    $sources = @(Get-ChildItem -LiteralPath "$PSScriptRoot/__tests__/native" -Filter '*.kt' | ForEach-Object FullName)
    $artifact = Join-Path $OutputDirectory 'native-check.jar'
    $recorder = Get-Content -LiteralPath $RecorderSource -Raw
    $start = $recorder.IndexOf('private class PolishedRecorder')
    if ($start -lt 0) { throw 'Production recorder class not found' }
    $recorderFile = Join-Path $OutputDirectory 'PolishedRecorder.kt'
    Set-Content -LiteralPath $recorderFile -Encoding utf8 -Value ("package com.freetune`nimport android.media.*`nimport java.io.File`n" + $recorder.Substring($start))
    $separator = [IO.Path]::PathSeparator
    & java -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath "$standardLibrary$separator$annotations" -d $artifact @sources $recorderFile "$PSScriptRoot/android/app/src/main/java/com/freetune/MicrophoneStreamModule.kt" "$PSScriptRoot/android/app/src/main/java/com/freetune/RecordingPolish.kt"
    if ($LASTEXITCODE -ne 0) { throw 'Kotlin compilation failed' }
    & java -cp "$artifact$separator$standardLibrary" CheckKt "$PSScriptRoot/assets/notebooks" $OutputDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Native regression checks failed' }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
