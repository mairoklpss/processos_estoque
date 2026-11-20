param(
  [ValidateSet('up','migrate','verify','test','start')][string]$Action = 'up',
  [string]$Source = '.local\backups\homologacao-source.sqlite',
  [string]$ComposePath = 'infra\docker-compose.homologacao.yml'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop não está instalado. Instale e inicie; nenhum serviço PostgreSQL existente será usado.' }
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Inicie o Docker Desktop antes de continuar.' }
$directory = Join-Path (Get-Location) '.local\postgres'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $directory '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger diretório das chaves.' }
function Read-ProtectedKey([string]$name) {
  $keyPath = Join-Path $directory ($name + '.dpapi.xml')
  if (-not (Test-Path $keyPath)) {
    if ($Action -ne 'up') { throw 'Execute up para provisionar as chaves locais primeiro.' }
    $volumes = & docker volume ls --filter 'label=com.docker.compose.project=brasilink-homologacao' --format '{{.Name}}'
    if ($volumes) { throw 'Já há volume de homologação e a chave não está disponível. Não será substituída automaticamente.' }
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    (ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force) | Export-Clixml -Path $keyPath -NoClobber
  }
  $secure = Import-Clixml -Path $keyPath
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$names = @('PG_LOCAL_PASSWORD','PG_APP_PASSWORD','PG_MIGRATION_URL','PG_MIGRATION_PROFILE','TEST_DATABASE_URL','DATABASE_URL','DATABASE_CLIENT','DATABASE_TARGET','APP_LOCAL_STATIC','PORT','HOST','NODE_ENV','APP_INSTANCE')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:PG_MIGRATION_PROFILE = 'homologacao'
  $env:DATABASE_TARGET = 'homologacao'
  $env:APP_LOCAL_STATIC = 'false'
  $env:PG_LOCAL_PASSWORD = Read-ProtectedKey 'admin'
  $env:PG_APP_PASSWORD = Read-ProtectedKey 'app'
  $adminSecret = [Uri]::EscapeDataString($env:PG_LOCAL_PASSWORD)
  $appSecret = [Uri]::EscapeDataString($env:PG_APP_PASSWORD)
  $env:PG_MIGRATION_URL = "postgresql://postgres:${adminSecret}@127.0.0.1:55432/brasilink_homologacao"
  switch ($Action) {
    'up' { & docker compose -f $ComposePath up -d --wait }
    'migrate' {
      & npx.cmd tsx scripts/postgres-migrate.ts --source $Source
      if ($LASTEXITCODE -ne 0) { throw 'Migração falhou; não continue para iniciar a aplicação.' }
      & npx.cmd tsx scripts/postgres-app-role.ts
    }
    'verify' { & npx.cmd tsx scripts/postgres-verify.ts --source $Source }
    'test' {
      $env:TEST_DATABASE_URL = $env:PG_MIGRATION_URL
      & npx.cmd tsx --test tests/database.test.ts tests/postgres-integration.test.ts
    }
    'start' {
      $env:DATABASE_CLIENT = 'postgres'
      $env:DATABASE_URL = "postgresql://brasilink_app:${appSecret}@127.0.0.1:55432/brasilink_homologacao"
      $env:APP_INSTANCE = 'homologacao'
      $env:PORT = '3100'; $env:HOST = '127.0.0.1'; $env:NODE_ENV = 'development'
      & npx.cmd tsx server.ts
    }
  }
  if ($LASTEXITCODE -ne 0) { throw 'A operação de homologação falhou. SQLite operacional preservado.' }
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
