// Short-lived repository access is supplied on stdin and never written to disk.
import { spawnSync } from 'node:child_process';
process.stdin.setEncoding('utf8');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('Ready for repository credential JSON on stdin (input is hidden).\n');
let input='';
process.stdin.on('data',chunk=>{
  input+=chunk;
  if(!input.includes('\n'))return;
  process.stdin.pause();
  try {
    const credential=JSON.parse(input.trim());input='';
    const env={...process.env};
    if(credential.auth_mode!=='work_proxy') {
      if(!credential.token)throw new Error('Repository credential is missing.');
      env.GIT_CONFIG_COUNT='1';env.GIT_CONFIG_KEY_0='http.extraHeader';
      env.GIT_CONFIG_VALUE_0='Authorization: Bearer '+credential.token;
    }
    const result=spawnSync('git',['push',credential.remote_url,'HEAD:'+credential.branch],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8'});
    if(result.stdout)process.stdout.write(result.stdout);
    if(result.stderr)process.stderr.write(result.stderr);
    process.exit(result.status??1);
  }catch(error){process.stderr.write(error.message+'\n');process.exit(1);}
});
