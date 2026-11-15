<#
  Transcode a video to H.264 MP4 (video only) with the Windows Media Foundation encoder, through the WinRT MediaTranscoder.
  Browsers do not play MPEG-4 Part 2 ("mp4v", the only MP4 codec OpenCV writes here); H.264 plays everywhere. No ffmpeg needed.
  Needs Windows PowerShell 5.1 (powershell.exe; pwsh cannot load WinRT types). Called by tools/encode-video.py:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/mp4-h264.ps1 in.mp4 out.mp4 [bits-per-second]
#>
param([Parameter(Mandatory = $true)][string]$In, [Parameter(Mandatory = $true)][string]$Out, [int]$Bitrate = 5000000)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]

# WinRT async calls are awaited through the .NET AsTask() extension methods
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
function Await($op, [type]$result) {
  $m = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $t = $m.MakeGenericMethod($result).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
function AwaitWithProgress($op) {
  $m = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
  $t = $m.MakeGenericMethod([double]).Invoke($null, @($op)); $t.Wait(-1) | Out-Null
}

$inPath = (Resolve-Path -LiteralPath $In).Path
$outPath = [IO.Path]::GetFullPath($Out)
$src = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($inPath)) ([Windows.Storage.StorageFile])
$dir = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync([IO.Path]::GetDirectoryName($outPath))) ([Windows.Storage.StorageFolder])
$dst = Await ($dir.CreateFileAsync([IO.Path]::GetFileName($outPath), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])

$enc = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp4([Windows.Media.MediaProperties.VideoEncodingQuality]::HD720p)
$enc.Audio = $null                                    # the demo video has no sound track
$enc.Video.Bitrate = $Bitrate
$enc.Video.FrameRate.Numerator = 30
$enc.Video.FrameRate.Denominator = 1

$tc = New-Object Windows.Media.Transcoding.MediaTranscoder
$prep = Await ($tc.PrepareFileTranscodeAsync($src, $dst, $enc)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prep.CanTranscode) { throw "cannot transcode: $($prep.FailureReason)" }
AwaitWithProgress ($prep.TranscodeAsync())
Write-Output ('{0}: {1:N1} MB, H.264' -f $outPath, ((Get-Item -LiteralPath $outPath).Length / 1MB))
