/** Produce a portable single-file edition from the exact modular website. */
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
const logo=await dataUri('dist/assets/logo.svg','image/svg+xml');
const landscape=await dataUri('dist/assets/field-landscape.jpg','image/jpeg');
let css=(await Promise.all(['dist/vendor/maplibre-gl.css','dist/styles.css','dist/planning.css','dist/scenes.css','dist/i18n.css','dist/intro.css','dist/intro-real.css'].map(read))).join('\n');
css=css.replaceAll("url('assets/field-landscape.jpg')",'url("'+landscape+'")');
for (const name of ['sea','forest','sky-clear','sky-clouds','sky-storm']) {
  const asset = await dataUri('dist/assets/'+name+'.jpg','image/jpeg');
  css = css.replace(new RegExp('url\\([\'\"]?assets/'+name+'\\.jpg[\'\"]?\\)','g'),()=> 'url("'+asset+'")');
}
html=html.replace(/<link rel="stylesheet" href="[^"]+">/g,'').replace('</head>',()=>'<style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head>');
html=html.replaceAll('assets/logo.svg',logo);
let js='const __fieldshiftModules = {};\n';
for(const name of ['data','geo','planning','scenes','i18n','intro']){
  let code=await read('dist/'+name+'.js');
  const names=[...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(m=>m[1]);
  if(!names.length)throw Error('No named exports in '+name);
  code=code.replace(/^export\s+/gm,'');
  if(/^import\s/m.test(code))throw Error('Resolve module imports before packaging '+name);
  js+='__fieldshiftModules.'+name+' = (()=>{\n'+code+'\nreturn {'+names.join(',')+'};\n})();\n';
}
let app=await read('dist/app.js');
app=app.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/(\w+)\.js['"];?/gm,(_match,names,module)=>'const {'+names+'} = __fieldshiftModules.'+module+';');
if(/^import\s/m.test(app))throw Error('Unresolved app import');
js+='(()=>{\n'+app+'\n})();';
const vendor=await read('dist/vendor/maplibre-gl.js');
html=html.replace('<script src="vendor/maplibre-gl.js"></script>',()=>'<script>'+scriptSafe(vendor)+'</script>');
html=html.replace('<script type="module" src="app.js"></script>',()=>'<script>'+scriptSafe(js)+'</script>');
html=html.replaceAll('assets/earth-texture.jpg',await dataUri('dist/assets/earth-texture.jpg','image/jpeg'));
const target=resolve(out,'FieldShift-Final.html');
await writeFile(target,html);
console.log('Portable website: '+target+' ('+Buffer.byteLength(html).toLocaleString()+' bytes)');
