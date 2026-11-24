param(
 [ValidateSet('up','migrate','verify','test','start','check','backup','restore-backup','schema-drop-observacoes','schema-rename-regiao','reset-usuario')][string]$Action='start',
 [string]$Source,
 [string]$InputPath,
 [string]$OutputPath,
 [switch]$Development
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location $root
$compose='infra\docker-compose.operacao.yml'
if(-not(Get-Command docker -ErrorAction SilentlyContinue)){throw 'Docker Desktop deve estar instalado e ativo.'}
& docker info --format '{{.ServerVersion}}' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Inicie o Docker Desktop; não usar PostgreSQL nativo nem SQLite como alternativa.'}
$directory=Join-Path $root '.local\operacao'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $directory '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Falha na proteção das chaves operacionais.'}
function Read-Key([string]$name){
 $file=Join-Path $directory ($name+'.dpapi.xml')
 if(-not(Test-Path $file)){
  if($Action -ne 'up'){throw 'Execute pg:operacao:up antes; não gerar outra chave para uma base existente.'}
  $volumes=& docker volume ls --filter 'label=com.docker.compose.project=brasilink-operacao' --format '{{.Name}}'
  if($volumes){throw 'Volume operacional já existe sem esta chave. Não substituir credenciais automaticamente.'}
  $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  (ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force)|Export-Clixml -Path $file -NoClobber
 }
 $secure=Import-Clixml $file;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
}
$names=@('PG_OPERACAO_PASSWORD','PG_APP_PASSWORD','PG_MIGRATION_URL','PG_MIGRATION_PROFILE','PG_MIGRATION_TEST_SOURCE','DATABASE_CLIENT','DATABASE_URL','DATABASE_TARGET','APP_INSTANCE','APP_LOCAL_STATIC','PORT','HOST','NODE_ENV','DISABLE_HMR','SQLITE_PATH','BACKUP_PASSPHRASE')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
 $env:PG_APP_PASSWORD=Read-Key 'app';$app=[Uri]::EscapeDataString($env:PG_APP_PASSWORD)
 $env:PG_OPERACAO_PASSWORD=$null;$env:PG_MIGRATION_URL=$null;$env:PG_MIGRATION_PROFILE=$null
 if($Action -in @('up','migrate','verify','test','schema-drop-observacoes','schema-rename-regiao')){
  $env:PG_OPERACAO_PASSWORD=Read-Key 'admin';$admin=[Uri]::EscapeDataString($env:PG_OPERACAO_PASSWORD)
  $env:PG_MIGRATION_PROFILE='operacao';$env:PG_MIGRATION_URL="postgresql://postgres:${admin}@127.0.0.1:55433/brasilink_operacao"
 }
 switch($Action){
  'up'{
   $listener=Get-NetTCPConnection -State Listen -LocalPort 55433 -ErrorAction SilentlyContinue
   $owned=& docker compose -f $compose ps -q postgres
   if($listener -and -not $owned){throw 'Porta 55433 ocupada por outro serviço; nada será interrompido.'}
   & docker compose -f $compose up -d --wait
  }
  'migrate'{
   if(-not $Source){throw 'Informe -Source com backup atualizado explícito; não usar o SQLite operacional diretamente.'}
   & npx.cmd tsx scripts/postgres-migrate.ts --source $Source
   if($LASTEXITCODE -ne 0){throw 'Migração não concluída; não iniciar aplicação.'}
   & npx.cmd tsx scripts/postgres-app-role.ts
  }
  'verify'{
   if(-not $Source){throw 'Informe o mesmo backup migrado.'}
   & npx.cmd tsx scripts/postgres-verify.ts --source $Source
  }
  'test'{
   if(-not $Source){throw 'Teste completo exige backup explícito e destino VAZIO.'}
   $env:PG_MIGRATION_TEST_SOURCE=(Resolve-Path $Source).Path
   & npx.cmd tsx --test tests/postgres-migration.test.ts
   if($LASTEXITCODE -ne 0){throw 'Ensaio falhou; não cortar operação.'}
   & npx.cmd tsx scripts/postgres-app-role.ts
  }
  'schema-rename-regiao'{
   if(-not $OutputPath){throw 'Informe -OutputPath com o backup .pgdump.enc criado imediatamente antes (issue 03).'}
   if(-not(Test-Path $OutputPath)){throw 'Backup informado não encontrado; rodar -Action backup primeiro.'}
   $env:DATABASE_URL=$env:PG_MIGRATION_URL
   & npx.cmd tsx scripts/pg-rename-regiao-filial.ts
   if($LASTEXITCODE -ne 0){throw 'Migração de schema falhou; verificar backup antes de repetir.'}
  }
  'schema-drop-observacoes'{
   if(-not $OutputPath){throw 'Informe -OutputPath com o backup .pgdump.enc criado imediatamente antes (issue 02).'}
   if(-not(Test-Path $OutputPath)){throw 'Backup informado não encontrado; rodar -Action backup primeiro.'}
   $env:DATABASE_URL=$env:PG_MIGRATION_URL
   & npx.cmd tsx scripts/pg-drop-observacoes.ts
   if($LASTEXITCODE -ne 0){throw 'Migração de schema falhou; verificar backup antes de repetir.'}
  }
  {$_ -in @('backup','restore-backup')}{
   $backupKey=Join-Path $root '.local\backups\key.dpapi.xml'
   if(-not(Test-Path $backupKey)){throw 'Chave existente de backup não encontrada; não gerar outra automaticamente.'}
   $secure=Import-Clixml $backupKey;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try{$env:BACKUP_PASSPHRASE=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
   $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
   if(-not $OutputPath){$extension=if($Action -eq 'backup'){'.pgdump.enc'}else{'.pgdump'};$OutputPath=Join-Path $root ('.local\operacao\backups\'+$stamp+$extension)}
   if($Action -eq 'backup'){& npx.cmd tsx scripts/postgres-backup.ts create --output $OutputPath}
   else{if(-not $InputPath){throw 'Informe InputPath.'};& npx.cmd tsx scripts/postgres-backup.ts restore --input $InputPath --output $OutputPath}
  }
  'reset-usuario'{
   if(-not $Source){throw 'Informe -Source com o username a redefinir (ex.: coordenador).'}
   $secureNova=Read-Host 'Nova senha (min 12 caracteres, com maiuscula, minuscula, numero e simbolo)' -AsSecureString
   $pointerNova=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureNova)
   try{$env:RESET_NOVA_SENHA=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointerNova)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointerNova)}
   $env:DATABASE_CLIENT='postgres';$env:DATABASE_TARGET='operacao';$env:DATABASE_URL="postgresql://brasilink_app:${app}@127.0.0.1:55433/brasilink_operacao"
   $env:NODE_ENV='development'
   & npx.cmd tsx scripts/reset-usuario.ts $Source
   $code=$LASTEXITCODE
   $env:RESET_NOVA_SENHA=$null
   if($code -ne 0){throw 'Redefinicao de senha falhou; nenhuma alteracao feita.'}
   Write-Output 'Senha redefinida; sessoes antigas revogadas. Entre com a nova senha.'
  }
  {$_ -in @('start','check')}{
   if($Action -eq 'start' -and -not $Development -and -not(Test-Path 'dist\index.html')){throw 'Execute npm run build antes de iniciar a operação estática.'}
   $env:DATABASE_CLIENT='postgres';$env:DATABASE_TARGET='operacao';$env:DATABASE_URL="postgresql://brasilink_app:${app}@127.0.0.1:55433/brasilink_operacao"
   $env:APP_INSTANCE='operacao';$env:SQLITE_PATH=$null;$env:HOST='127.0.0.1';$env:PORT='3000';$env:NODE_ENV='development';$env:DISABLE_HMR='true'
   $env:APP_LOCAL_STATIC=if($Development){'false'}else{'true'}
   $env:PG_APP_PASSWORD=$null;$env:BACKUP_PASSPHRASE=$null
   if($Action -eq 'check'){& npx.cmd tsx scripts/operacao-check.ts}else{& npx.cmd tsx server.ts}
  }
 }
 if($LASTEXITCODE -ne 0){throw 'Operação local falhou; não tentar SQLite silenciosamente.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
