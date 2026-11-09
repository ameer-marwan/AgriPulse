/** Export the same photographic growth animation used by the intro as a real GIF. */
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
await mkdir(resolve(root,'../../scratch'),{recursive:true});
const frames=await mkdtemp(resolve(root,'../../scratch/plant-growth-'));
const browser=await playwright.chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
  const page=await browser.newPage();
  await page.route('**/growth-render.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><canvas></canvas></body></html>'}));
  await page.goto(origin+'/growth-render.html');
  const ready=await page.evaluate(async()=>{
    const {createPlantGrowth}=await import('/growth.js');
    window.growth=createPlantGrowth(document.querySelector('canvas'),document.body);
    return await window.growth.ready;
  });
  if(!ready)throw Error('Photographic animation assets did not load.');
  for(let i=0;i<111;i++){
    const image=await page.evaluate(t=>{window.growth.draw(t);return document.querySelector('canvas').toDataURL('image/png').split(',')[1];},i/15);
    await writeFile(resolve(frames,`frame-${String(i).padStart(3,'0')}.png`),Buffer.from(image,'base64'));
  }
  await page.evaluate(()=>window.growth.destroy());
}finally{await browser.close();}
const run=args=>new Promise((ok,fail)=>{const child=spawn('ffmpeg',['-y','-loglevel','error',...args],{stdio:'inherit'});child.on('error',fail);child.on('close',code=>code===0?ok():fail(Error('ffmpeg exit '+code)));});
const input=resolve(frames,'frame-%03d.png');
const target=resolve(root,'dist/assets/agripulse-plant-growth.gif');
await run(['-framerate','15','-i',input,'-filter_complex','[0:v]scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle','-loop','0',target]);
await run(['-framerate','15','-i',input,'-c:v','libx264','-pix_fmt','yuv420p','-crf','19','-movflags','+faststart',resolve(root,'dist/assets/agripulse-plant-growth.mp4')]);
console.log(JSON.stringify({gif:target,frames:111,duration:7.4,previewFrames:frames}));
