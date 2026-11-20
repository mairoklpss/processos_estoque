param(
  [ValidateSet('create', 'restore')][string]$Mode = 'create',
  [string]$OutputPath,
  [string]$InputPath
)
$ErrorActionPreference = 'Stop'
# Executar na raiz do projeto, sob a conta Windows da usuária.
$directory = Join-Path (Get-Location) '.local\backups'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $directory '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger diretório de backups.' }
$keyPath = Join-Path $directory 'key.dpapi.xml'
if (-not (Test-Path $keyPath)) {
  if ($Mode -eq 'restore') { throw 'Chave DPAPI não encontrada. Restauração não deve gerar outra chave.' }
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $secure = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
  $secure | Export-Clixml -Path $keyPath -NoClobber
}
$secure = Import-Clixml -Path $keyPath
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previous = $env:BACKUP_PASSPHRASE
try {
  $env:BACKUP_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if (-not $OutputPath) {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $extension = if ($Mode -eq 'create') { '.backup.enc' } else { '.sqlite' }
    $OutputPath = Join-Path $directory ($stamp + $extension)
  }
  if ($Mode -eq 'create') {
    & npx.cmd tsx scripts/backup.ts create --output $OutputPath
  } else {
    if (-not $InputPath) { throw 'Informe InputPath para restaurar.' }
    & npx.cmd tsx scripts/backup.ts restore --input $InputPath --output $OutputPath
  }
  if ($LASTEXITCODE -ne 0) { throw 'Falha no backup/restauração.' }
  Write-Output "Arquivo: $OutputPath"
  Write-Output 'Chave protegida por DPAPI sob esta conta Windows; não sincronize nem versione o arquivo da chave.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $env:BACKUP_PASSPHRASE = $previous
}
