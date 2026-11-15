import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

const root = new URL('../',import.meta.url);
const read = path => readFile(new URL(path,root),'utf8');
const illustrations=[
  'explore-china','explore-ksa','explore-netherlands','explore-kenya','explore-brazil',
  'field-landscape','intro-farmland','intro-plant','intro-soil','intro-space',
  'earth-texture','forest','sea','sky-clear','sky-clouds','sky-storm'
];
const runtime=[
  'dist/app.js','dist/intro.js','dist/growth.js','dist/styles.css',
  'dist/polish.css','dist/scenes.css','dist/intro-real.css',
  'scripts/package-final.mjs'
];

test('All replacement illustrations visibly carry SI attribution and no NASA branding',async()=>{
 for(const name of illustrations) {
   const svg=await read('dist/assets/'+name+'.svg');
   assert.match(svg,/<svg/);
   assert.match(svg,/SI-GENERATED VISUAL/);
   assert.match(svg,/not observational imagery|not observational data|not observational/i);
   assert.doesNotMatch(svg,/NASA|Space Apps/i);
   assert.ok((await stat(new URL('dist/assets/'+name+'.svg',root))).size < 12000);
 }
});

test('Web runtime no longer references uncertain-origin raster scenery',async()=>{
 const sceneIllustrations=illustrations.filter(name=>!['field-landscape','earth-texture','intro-farmland','intro-plant','intro-soil'].includes(name));
 const legacy=new RegExp('assets/(?:'+sceneIllustrations.join('|')+')\\.(?:jpg|jpeg|webp)','i');
 for(const path of runtime) {
   assert.doesNotMatch(await read(path),legacy,'Unsupported old media path in '+path);
 }
});

test('Promotional links do not present legacy 8-page or unwarranted video as judging-ready',async()=>{
 for(const path of ['README.md','dist/app.js']) {
   const body=await read(path);
   assert.doesNotMatch(body,/raw\/main\/media\/AgriPulse_Space_to_Soil\.pdf/i,'legacy pitch advertised in '+path);
   assert.doesNotMatch(body,/raw\/main\/media\/how-nasa-data-solves-farming\.mp4/i,'legacy video advertised in '+path);
 }
});
