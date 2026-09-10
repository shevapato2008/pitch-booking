// Bounded, read-only DevTools diagnostics. Generated JSONL contains metrics and error excerpts only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(dir,`enfile-monitor-${Date.now()}.jsonl`);
const fd=fs.openSync(output,'wx',0o600);
const roots=['50a7d9210159a32f006158795f893857','d1e8765721a6c23d43b14c95b1843e6b'].map(id=>`/Users/fan/Library/Application Support/微信开发者工具/${id}/WeappLog/logs`);
const offsets=new Map();
const files=()=>roots.flatMap(root=>fs.existsSync(root)?fs.readdirSync(root).filter(n=>n.endsWith('.log')).map(n=>path.join(root,n)):[]);
for(const file of files()) offsets.set(file,fs.statSync(file).size);
let samples=0,min=Infinity,max=0,errors=0,worktreeMentions=0,bytes=0;
const emit=record=>{const line=JSON.stringify({time:new Date().toISOString(),...record});fs.writeSync(fd,line+'\n');console.log(line);};
emit({event:'start',pid:process.pid,output,baselineLogFiles:offsets.size});
function sample(){
  const metrics=Object.fromEntries(execFileSync('/usr/sbin/sysctl',['kern.num_files','kern.maxfiles'],{encoding:'utf8',timeout:3000}).trim().split('\n').map(s=>{const [k,v]=s.split(': ');return [k,Number(v)];}));
  const count=metrics['kern.num_files']; min=Math.min(min,count);max=Math.max(max,count);samples++;
  if(samples===1||samples%5===0) emit({event:'files',...metrics});
  if(count>metrics['kern.maxfiles']*0.5) emit({event:'pressure-warning',count});
  for(const file of files()){
    const size=fs.statSync(file).size;let offset=offsets.get(file)||0;if(size<offset)offset=0;
    if(size===offset)continue;
    const input=fs.openSync(file,'r');let carry='';
    try{while(offset<size){const buffer=Buffer.alloc(Math.min(65536,size-offset));const n=fs.readSync(input,buffer,0,buffer.length,offset);if(!n)break;offset+=n;bytes+=n;const content=carry+buffer.subarray(0,n).toString('utf8');const lines=content.split('\n');carry=lines.pop()||'';if(offset===size&&carry){lines.push(carry);carry='';}for(const line of lines){if(/ENFILE|EMFILE|file table overflow|Too many open files/i.test(line)){errors++;const index=line.search(/ENFILE|EMFILE|file table overflow|Too many open files/i);emit({event:'file-error',file,excerpt:line.slice(Math.max(0,index-60),index+260)});}if(line.includes('/.worktrees/'))worktreeMentions++;}}}finally{fs.closeSync(input);}
    offsets.set(file,offset);
  }
}
sample();
const timer=setInterval(()=>{try{sample();}catch(e){emit({event:'monitor-error',message:e.message});}},2000);
const deadline=setTimeout(()=>finish('10-minute-limit'),600000);
function finish(reason){clearInterval(timer);clearTimeout(deadline);sample();emit({event:'summary',reason,samples,min,max,fileErrors:errors,worktreeMentions,newLogBytes:bytes});fs.closeSync(fd);process.exit(errors?2:0);}
process.on('SIGTERM',()=>finish('stopped-after-review'));
process.on('SIGINT',()=>finish('interrupted'));
