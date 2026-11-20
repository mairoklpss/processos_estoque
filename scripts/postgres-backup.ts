import fs, {promises as files} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {encryptPgDump,decryptPgDump} from '../server/postgres-backup-store.ts';
const root=process.cwd(),directory=path.resolve(root,'.local/operacao/backups');
const secret=process.env.BACKUP_PASSPHRASE;
const args=process.argv.slice(2),mode=args.shift();
function option(name:string):string{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error('Argumento de backup obrigatório.');return path.resolve(args[i+1]);}
function within(file:string){const relative=path.relative(directory,file);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Usar arquivos novos dentro de .local/operacao/backups.');}
async function dump(output:string){
 const metadata=spawn('docker',['inspect','brasilink-operacao-postgres-1','--format','{{index .Config.Labels "com.docker.compose.project"}}'],{stdio:['ignore','pipe','ignore']});
 let label='';metadata.stdout.on('data',d=>label+=d);
 const status=await new Promise<number|null>((resolve,reject)=>{metadata.on('error',reject);metadata.on('close',resolve);});
 if(status!==0||label.trim()!=='brasilink-operacao')throw new Error('Contêiner operacional não confirmado.');
 const handle=await files.open(output,'wx',0o600);
 try{
  const child=spawn('docker',['exec','brasilink-operacao-postgres-1','pg_dump','-U','postgres','-d','brasilink_operacao','-Fc'],{stdio:['ignore',handle.fd,'ignore']});
  const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  if(code!==0)throw new Error('pg_dump falhou.');
 }finally{await handle.close();}
}
async function main(){
 if(!secret||secret.length<16)throw new Error('Chave deve ser injetada no ambiente.');
 if(!['create','restore'].includes(mode??''))throw new Error('Use create ou restore.');
 if(args.length!==(mode==='create'?2:4)||new Set(args.filter(a=>a.startsWith('--'))).size!==(mode==='create'?1:2))throw new Error('Argumentos inválidos.');
 const output=option('--output');within(output);await files.mkdir(directory,{recursive:true});
 if(mode==='create'){
  const temp=await files.mkdtemp(path.join(directory,'.pg-dump-')),plain=path.join(temp,'dump.pgdump');
  try{await dump(plain);await encryptPgDump(plain,output,secret);}finally{await files.rm(temp,{recursive:true,force:true});}
 }else{const input=option('--input');within(input);await decryptPgDump(input,output,secret);}
 console.log(JSON.stringify({mode,path:output,encrypted:mode==='create',existingFilesOverwritten:false}));
}
main().catch(()=>{console.error('PG_BACKUP_FAILED: verificar Docker operacional, chave protegida e saída nova; nenhum banco existente foi substituído.');process.exitCode=1;});
