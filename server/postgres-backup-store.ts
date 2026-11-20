import crypto from 'node:crypto';
import fs, {promises as files, constants} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const magic=Buffer.from('BRASILINK-PGDUMP-1\n');
const headerSize=magic.length+16+12;
function key(secret:string,salt:Buffer):Promise<Buffer>{
 if(secret.length<16||secret.length>1024)throw new Error('Chave de backup inválida.');
 return new Promise((resolve,reject)=>crypto.scrypt(secret,salt,32,{N:16384,r:8,p:1},(err,key)=>err?reject(err):resolve(key)));
}
export async function encryptPgDump(input:string,output:string,secret:string):Promise<void>{
 if(path.resolve(input)===path.resolve(output))throw new Error('Origem e saída devem ser distintas.');
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),header=Buffer.concat([magic,salt,iv]);
 const derived=await key(secret,salt),cipher=crypto.createCipheriv('aes-256-gcm',derived,iv);derived.fill(0);cipher.setAAD(header);
 let owned=false;
 try{
  const target=fs.createWriteStream(output,{flags:'wx',mode:0o600});target.once('open',()=>owned=true);target.write(header);
  await pipeline(fs.createReadStream(input),cipher,target);await files.appendFile(output,cipher.getAuthTag());
 }catch(error){if(owned)await files.unlink(output).catch(()=>{});throw error;}
}
export async function decryptPgDump(input:string,output:string,secret:string):Promise<void>{
 if(path.resolve(input)===path.resolve(output))throw new Error('Origem e saída devem ser distintas.');
 const stat=await files.stat(input);if(stat.size<headerSize+16)throw new Error('Backup inválido.');
 const file=await files.open(input,'r'),header=Buffer.alloc(headerSize),tag=Buffer.alloc(16);
 try{await file.read(header,0,header.length,0);await file.read(tag,0,16,stat.size-16);}finally{await file.close();}
 if(!header.subarray(0,magic.length).equals(magic))throw new Error('Formato inválido.');
 const derived=await key(secret,header.subarray(magic.length,magic.length+16));
 const decipher=crypto.createDecipheriv('aes-256-gcm',derived,header.subarray(magic.length+16));derived.fill(0);decipher.setAAD(header);decipher.setAuthTag(tag);
 const temp=await files.mkdtemp(path.join(path.dirname(path.resolve(output)),'.pg-restore-')),plain=path.join(temp,'dump.pgdump');
 try{
  await pipeline(fs.createReadStream(input,{start:headerSize,end:stat.size-17}),decipher,fs.createWriteStream(plain,{flags:'wx',mode:0o600}));
  const check=await files.open(plain,'r');const prefix=Buffer.alloc(5);try{await check.read(prefix,0,5,0);}finally{await check.close();}
  if(prefix.toString()!=='PGDMP')throw new Error('Conteúdo não é arquivo pg_dump custom.');
  await files.copyFile(plain,output,constants.COPYFILE_EXCL);
 }finally{await files.rm(temp,{recursive:true,force:true});}
}
