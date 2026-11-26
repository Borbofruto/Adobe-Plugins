# Instala o painel Better Item no Illustrator (Windows), sem assinatura, para desenvolvimento.
# Uso (PowerShell, na pasta better-item-illustrator):
#   powershell -ExecutionPolicy Bypass -File install\instalar-windows.ps1          # copia os arquivos
#   powershell -ExecutionPolicy Bypass -File install\instalar-windows.ps1 -Link    # cria um link (edições valem na hora)
param([switch]$Link)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:APPDATA 'Adobe\CEP\extensions\better-item-illustrator'

# Extensões sem assinatura precisam do modo de depuração do CEP.
foreach ($v in 11, 12) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}

New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) { Remove-Item -Recurse -Force $target }

if ($Link) {
    New-Item -ItemType Junction -Path $target -Target $source | Out-Null
    Write-Host "Link criado: $target -> $source"
} else {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($d in 'CSXS', 'client', 'host') { Copy-Item -Recurse (Join-Path $source $d) $target }
    Copy-Item (Join-Path $source '.debug') $target
    Write-Host "Copiado para: $target"
}
Write-Host 'Reinicie o Illustrator e abra Janela > Extensões > Better Item.'
