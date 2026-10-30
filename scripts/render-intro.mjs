/** Rebuild the 1280x720 cinematic intro from the bundled scene assets. Requires ffmpeg. */
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const asset=name=>resolve(root,'dist/assets/'+name);
const filter=[
  "[0:v]scale=660:660,pad=1280:720:310:30:black,rotate=0.035*t:ow=1280:oh=720:c=black,zoompan=z='if(lt(on,65),1+on*0.003,1.195+(on-65)*0.055)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,setsar=1[e]",
  "[1:v]scale=1280:720,zoompan=z='min(1.02+on*0.014,2.35)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,setsar=1[f]",
  "[2:v]scale=1280:720,zoompan=z='min(1.22+on*0.002,1.42)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,setsar=1[p]",
  '[e][f]xfade=transition=fade:duration=0.5:offset=2.7[ef]',
  '[ef][p]xfade=transition=fade:duration=0.5:offset=5.2,format=yuv420p[out]'
].join(';');
const args=['-y','-loglevel','error'];
for(const [name,duration] of [['intro-earth.jpg','3.2'],['intro-farm.jpg','3.0'],['intro-plant.jpg','3.3']])args.push('-loop','1','-framerate','30','-t',duration,'-i',asset(name));
args.push('-filter_complex',filter,'-map','[out]','-an','-c:v','libx264','-preset','veryfast','-crf','21','-movflags','+faststart',asset('intro-journey.mp4'));
const result=spawnSync('ffmpeg',args,{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log('Rendered '+asset('intro-journey.mp4'));
const mobileFilter=[
  "[0:v]scale=650:650,pad=720:1280:35:315:black,rotate=0.035*t:ow=720:oh=1280:c=black,zoompan=z='if(lt(on,65),1+on*0.003,1.195+(on-65)*0.055)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=30,setsar=1[e]",
  "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(1.02+on*0.014,2.35)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=30,setsar=1[f]",
  "[2:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(1.22+on*0.002,1.42)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=30,setsar=1[p]",
  '[e][f]xfade=transition=fade:duration=0.5:offset=2.7[ef]',
  '[ef][p]xfade=transition=fade:duration=0.5:offset=5.2,format=yuv420p[out]'
].join(';');
const mobileArgs=[...args];mobileArgs[mobileArgs.indexOf(filter)]=mobileFilter;mobileArgs[mobileArgs.length-1]=asset('intro-journey-mobile.mp4');
const mobileResult=spawnSync('ffmpeg',mobileArgs,{stdio:'inherit'});
if(mobileResult.status!==0)process.exit(mobileResult.status||1);
console.log('Rendered '+asset('intro-journey-mobile.mp4'));
