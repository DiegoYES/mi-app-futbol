# Descarga el backup mas reciente de Data Fut y verifica su integridad.
# Descarga a un archivo temporal y solo reemplaza la copia anterior si el
# checksum coincide; registra cada corrida en estado-descarga.txt.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File descargar-backup-laptop.ps1
$ErrorActionPreference = 'Stop'
$Destino = "C:\Backups\DataFut"
$Estado = Join-Path $Destino "estado-descarga.txt"
$LogError = Join-Path $Destino "error-descarga.txt"
$Staging = "/tmp/datafut-pull.archive.gz"
$SshArgs = @('-o','BatchMode=yes','data-fut-admin')
$ScpArgs = @('-o','BatchMode=yes')

function Registrar([string]$Mensaje) {
    Add-Content -Path $Estado -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensaje)
}

function Descargar-Directo([string]$RutaRemota, [string]$ArchivoLocal) {
    $ErrTmp = Join-Path $env:TEMP "datafut-stderr.txt"
    $Proc = Start-Process -FilePath "ssh" `
        -ArgumentList ($SshArgs + "sudo cat '$RutaRemota'") `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $ArchivoLocal `
        -RedirectStandardError $ErrTmp
    $Proc.WaitForExit()
    if ($Proc.ExitCode -eq 0) { return $true }
    $Script:DetalleStderr = (Get-Content $ErrTmp -Raw -ErrorAction SilentlyContinue)
    return $false
}

function Descargar-Scp([string]$RutaRemota, [string]$ArchivoLocal) {
    & ssh @SshArgs "sudo sh -c 'cp --preserve=timestamps '$RutaRemota' $Staging && chown diego:diego $Staging'"
    if ($LASTEXITCODE -ne 0) { return $false }
    & scp @ScpArgs "data-fut-admin:$Staging" "$ArchivoLocal" 2>$null
    $Ok = ($LASTEXITCODE -eq 0)
    & ssh @SshArgs "rm -f $Staging" | Out-Null
    return $Ok
}

try {
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null

    Write-Host "Buscando backup mas reciente en el servidor..."
    $Remoto = & ssh @SshArgs "sudo sh -c 'ls -1t /var/backups/data-fut-mongodb/mongodb-*.archive.gz | head -n1'"
    if (-not $Remoto) { throw "No hay backup remoto disponible." }
    $Nombre = Split-Path $Remoto -Leaf
    $Archivo = Join-Path $Destino $Nombre
    $Temporal = "$Archivo.descarga.tmp"

    if (Test-Path $Archivo) {
        Write-Host "La copia $Nombre ya existe localmente."
        Registrar "OMITIDO ya existe $Nombre"
        exit 0
    }

    Write-Host "Descargando $Nombre ..."
    $Script:DetalleStderr = ""
    $Ok = Descargar-Directo $Remoto $Temporal
    if (-not $Ok) {
        Write-Host "Metodo directo fallo; intentando plan B (staging + scp)..."
        $Ok = Descargar-Scp $Remoto $Temporal
    }
    if ((-not $Ok) -or (-not (Test-Path $Temporal))) {
        Remove-Item $Temporal -Force -ErrorAction SilentlyContinue
        $Script:DetalleStderr | Set-Content -Path $LogError -Encoding UTF8
        Registrar "FALLO descarga $Nombre (detalle en error-descarga.txt)"
        throw "La descarga fallo. Detalle tecnico en $LogError"
    }

    Write-Host "Verificando checksum..."
    $SumaRemota = (& ssh @SshArgs "sudo cat '$Remoto.sha256'") -split '\s+' | Select-Object -First 1
    $SumaLocal  = (Get-FileHash $Temporal -Algorithm SHA256).Hash.ToLower()
    if ($SumaLocal -ne $SumaRemota) {
        Remove-Item $Temporal -Force
        Registrar "FALLO checksum $Nombre"
        throw "Checksum NO coincide. Copia temporal eliminada; la copia previa queda intacta."
    }

    Move-Item -Force -Path $Temporal -Destination $Archivo
    Registrar "OK $Nombre"
    Write-Host "OK: copia verificada en $Archivo"

    Get-ChildItem "$Destino\mongodb-*.archive.gz" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 7 |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
catch {
    Registrar "ERROR $($_.Exception.Message)"
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}
