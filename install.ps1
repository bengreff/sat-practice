# SAT Practice installer for Windows.
#   irm https://raw.githubusercontent.com/bengreff/sat-practice/main/install.ps1 | iex
# Installs (or updates) the app in %USERPROFILE%\SATPractice, adds a desktop shortcut, and starts it.
# Your progress (progress.json, backups\) is never touched by an update.
$ErrorActionPreference = 'Stop'
$Repo = 'bengreff/sat-practice'
$Dest = if ($env:SAT_PRACTICE_DIR) { $env:SAT_PRACTICE_DIR } else { Join-Path $HOME 'SATPractice' }
$Zip = "https://codeload.github.com/$Repo/zip/refs/heads/main"

$Candidates = @(
  @{ Exe = 'py'; Pre = @('-3') },
  @{ Exe = 'python'; Pre = @() },
  @{ Exe = 'python3'; Pre = @() }
)
function Find-Python {
  foreach ($c in $Candidates) {
    if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
    try {
      # the Microsoft Store "python" alias prints a message instead of running, so check real output
      $pre = $c.Pre
      $v = & $c.Exe @pre -c "import sys; print(sys.version_info >= (3, 8))" 2>$null
      if ("$v".Trim() -eq 'True') { return $c }
    } catch {}
  }
  return $null
}

# 1. Python 3 (installed with winget if missing)
$py = Find-Python
if (-not $py) {
  Write-Host 'Installing Python 3 with winget...'
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements | Out-Host
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $py = Find-Python
  if (-not $py) { throw 'Python 3 could not be installed automatically. Install it from https://www.python.org/downloads/ and run this again.' }
}
$pyExe = (Get-Command $py.Exe).Source
$pyArgs = $py.Pre -join ' '

# 2. Download and install/update the app files
Write-Host 'Downloading SAT Practice...'
$tmp = Join-Path $env:TEMP ("satp-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $Zip -OutFile (Join-Path $tmp 'app.zip')
Expand-Archive -Path (Join-Path $tmp 'app.zip') -DestinationPath $tmp
$src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path (Join-Path $src.FullName '*') -Destination $Dest -Recurse -Force
Remove-Item -Recurse -Force $tmp

# 3. Launcher on the desktop
$bat = Join-Path $Dest 'SAT Practice.bat'
Set-Content -Path $bat -Encoding ASCII -Value "@echo off`r`ncd /d `"$Dest`"`r`n`"$pyExe`" $pyArgs server.py`r`n"
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SAT Practice.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk); $s.TargetPath = $bat; $s.WorkingDirectory = $Dest; $s.Save()
Write-Host 'Launcher: "SAT Practice" on your desktop'

# 4. Start it (the server opens your browser; a copy that is already running is reused)
Write-Host "Installed in $Dest. Starting..."
if ($env:SAT_PRACTICE_NO_START -ne '1') { Start-Process -FilePath $bat -WorkingDirectory $Dest -WindowStyle Minimized }
