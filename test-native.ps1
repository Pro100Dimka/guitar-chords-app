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
    $filesStart = $recorder.IndexOf('    private fun localFile(')
    $filesEnd = $recorder.IndexOf('    @ReactMethod @Synchronized fun playTake(', $filesStart)
    $deleteIndex = $recorder.IndexOf('fun deleteTake(')
    $deleteStart = $recorder.LastIndexOf('    @ReactMethod', $deleteIndex)
    $deleteEnd = $recorder.IndexOf('    @ReactMethod @Synchronized fun playSuccess(', $deleteIndex)
    if (@($filesStart, $filesEnd, $deleteStart, $deleteEnd) | Where-Object { $_ -lt 0 }) { throw 'Production recording file methods not found' }
    $filesProbe = Join-Path $OutputDirectory 'RecordingStoreProbe.kt'
    Set-Content -LiteralPath $filesProbe -Encoding utf8 -Value ("package com.freetune`nimport android.media.*`nimport com.facebook.react.bridge.*`nimport java.io.File`nimport java.nio.ByteBuffer`nclass RecordingStoreProbe(val directory: File) {`nval processing=mutableSetOf<String>()`nvar take: File?=null`nvar recorder: Any?=null`nfun stopPlayback() {}`n" + $recorder.Substring($filesStart, $filesEnd-$filesStart) + $recorder.Substring($deleteStart, $deleteEnd-$deleteStart) + "`n}")
    $recognition = Get-Content -LiteralPath "$PSScriptRoot/android/app/src/main/java/com/freetune/SongRecognitionModule.kt" -Raw
    $sessionStart = $recognition.IndexOf('internal class RecognitionSession')
    if ($sessionStart -lt 0) { throw 'Recognition session class not found' }
    Set-Content -LiteralPath (Join-Path $OutputDirectory 'RecognitionSession.kt') -Encoding utf8 -Value ("package com.freetune`nimport java.util.concurrent.*`nimport java.util.concurrent.atomic.*`nimport android.os.CancellationSignal`nimport java.io.Closeable`n" + $recognition.Substring($sessionStart))
    $separator = [IO.Path]::PathSeparator
    & java -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath "$standardLibrary$separator$annotations" -d $artifact @sources (Join-Path $OutputDirectory 'RecognitionSession.kt') $filesProbe $recorderFile "$PSScriptRoot/android/app/src/main/java/com/freetune/MicrophoneStreamModule.kt" "$PSScriptRoot/android/app/src/main/java/com/freetune/RecordingPolish.kt"
    if ($LASTEXITCODE -ne 0) { throw 'Kotlin compilation failed' }
    & java -cp "$artifact$separator$standardLibrary" CheckKt "$PSScriptRoot/assets/notebooks" $OutputDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Native regression checks failed' }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
