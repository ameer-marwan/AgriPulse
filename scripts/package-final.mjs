/** Produce a portable single-file edition from the current modular website. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.argv[2]||resolve(root,'release'));
await mkdir(out,{recursive:true});
const read=path=>readFile(resolve(root,path),'utf8');
const dataUri=async(path,type)=>'data:'+type+';base64,'+(await readFile(resolve(root,path))).toString('base64');
const scriptSafe=s=>s.replace(/<\/script/gi,'<\\/script');
let html=await read('dist/index.html');
const logo=await dataUri('dist/assets/logo-new.png','image/png');
let css=(await Promise.all(['dist/vendor/maplibre-gl.css','dist/styles.css','dist/planning.css','dist/scenes.css','dist/i18n.css','dist/intro.css','dist/intro-real.css','dist/accounts.css','dist/field-controls.css','dist/polish.css'].map(read))).join('\n');
// Package only the reviewed local visuals used by the site.
const illustrationNames=[
  'explore-china','explore-ksa','explore-netherlands','explore-kenya','explore-brazil',
  'field-landscape','intro-farmland','intro-plant','intro-soil','intro-space',
  'earth-texture','forest','sea','sky-clear','sky-clouds','sky-storm'
];
const inlinedArt = new Map();
for (const name of illustrationNames) {
  inlinedArt.set(name,await dataUri('dist/assets/'+name+'.svg','image/svg+xml'));
}
for (const [name,data] of inlinedArt) {
  css=css.replaceAll("assets/"+name+".svg",data);
}
const introRasters = new Map([
  ['field-landscape', await dataUri('dist/assets/field-landscape.jpg','image/jpeg')],
  ['earth-texture', await dataUri('dist/assets/earth-texture.jpg','image/jpeg')],
  ['intro-farmland', await dataUri('dist/assets/intro-farmland.jpg','image/jpeg')],
  ['intro-plant', await dataUri('dist/assets/intro-plant.jpg','image/jpeg')],
  ['intro-soil', await dataUri('dist/assets/intro-soil.jpg','image/jpeg')],
  ['irrigation-water', await dataUri('dist/assets/irrigation-water.jpg','image/jpeg')]
]);
for (const [name,data] of introRasters) {
  css=css.replaceAll('assets/'+name+'.jpg',data);
}
html=html.replace(/<link rel="stylesheet" href="[^"]+"\s*\/?>/g,'')
  .replace('</head>',()=>'<style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head>');
html=html.replaceAll('assets/logo-new.png',logo);
html=html.replaceAll('assets/dunia-alajial-logo.jpg',await dataUri('dist/assets/dunia-alajial-logo.jpg','image/jpeg'));
let js='(async()=>{\nconst __fieldshiftModules = {};\n';
for(const name of ['storage','accounts','data','geo','planning','scenes','i18n','growth','intro']){
  let code=await read('dist/'+name+'.js');
  const names=[...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(m=>m[1]);
  if(!names.length)throw Error('No named exports in '+name);
  code=code.replace(/^export\s+/gm,'');
  code=code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/(\w+)\.js['"];?/gm,(_match,names,module)=>'const {'+names+'} = __fieldshiftModules.'+module+';');
  if(/^import\s/m.test(code))throw Error('Resolve module imports before packaging '+name);
  js+='__fieldshiftModules.'+name+' = (()=>{\n'+code+'\nreturn {'+names.join(',')+'};\n})();\n';
}
let app=await read('dist/app.js');
app=app.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/(\w+)\.js['"];?/gm,(_match,names,module)=>'const {'+names+'} = __fieldshiftModules.'+module+';');
if(/^import\s/m.test(app))throw Error('Unresolved app import');
js+=app+'\n})().catch(error=>{console.error(error);document.body.classList.remove("intro-pending");});';
const vendor=await read('dist/vendor/maplibre-gl.js');
html=html.replace('<script src="vendor/maplibre-gl.js"></script>',()=>'<script>'+scriptSafe(vendor)+'</script>');
html=html.replace('<script type="module" src="app.js"></script>',()=>'<script>'+scriptSafe(js)+'</script>');
// Runtime-created intro and explorer markup is embedded in the JS string.
html=html.replaceAll('assets/logo-new.png',logo);
for (const [name,data] of inlinedArt) {
  html=html.replaceAll('assets/'+name+'.svg',data);
}
for (const [name,data] of introRasters) {
  html=html.replaceAll('assets/'+name+'.jpg',data);
}
if(html.includes('assets/logo-new.png')||/assets\/[\w-]+\.(?:webp|jpg|png|svg)/i.test(html) &&
   !html.includes('assets/dunia-alajial-logo.jpg') && !html.includes('assets/logo-new.png')) {
  // Keep the build independent from local scene files; any remaining references should be investigated.
  const missing=[...new Set(html.match(/assets\/[\w-]+\.(?:webp|jpg|png|svg)/gi)||[])];
  if (missing.length) throw Error('Portable build contains unresolved assets: '+missing.join(', '));
}
const target=resolve(out,'FieldShift-Final.html');
await writeFile(target,html);
await writeFile(resolve(out,'index.html'),html);
console.log('Portable website: '+target+' ('+Buffer.byteLength(html).toLocaleString()+' bytes)');
