param(
    [Parameter(Mandatory = $true)][string]$KotlinLib,
    [string]$OutputDirectory = 'E:\CodexTemp\guitar-native-tests'
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
    $standardLibrary = @(Get-ChildItem -LiteralPath $KotlinLib -Filter 'kotlin-stdlib-*.jar')[0].FullName
    $annotations = @(Get-ChildItem -LiteralPath $KotlinLib -Filter 'annotations-*.jar')[0].FullName
    $sources = @(Get-ChildItem -LiteralPath "$PSScriptRoot/__tests__/native" -Filter '*.kt' | ForEach-Object FullName)
    $artifact = Join-Path $OutputDirectory 'native-check.jar'
    & java -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath "$standardLibrary;$annotations" -d $artifact @sources "$PSScriptRoot/android/app/src/main/java/com/freetune/MicrophoneStreamModule.kt"
    if ($LASTEXITCODE -ne 0) { throw 'Kotlin compilation failed' }
    & java -cp "$artifact;$standardLibrary" CheckKt "$PSScriptRoot/assets/notebooks"
    if ($LASTEXITCODE -ne 0) { throw 'Native regression checks failed' }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
