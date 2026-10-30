import {fetchWeather, searchPlaces, fetchNasa, crops, recommendRotations, calculateEconomics, formatWeatherCode} from './data.js';
import {createFieldMap, polygonAreaHa, validatePolygon, polygonReferencePoint} from './geo.js';
import {initPlanning} from './planning.js';
import {initScenes} from './scenes.js';

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const text = (q, value) => $$(q).forEach(el => { el.textContent = value; });
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => typeof n === 'number' && Number.isFinite(n);
function read(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Device storage is unavailable. Export a report to keep your work.'); } }
const example = {lat:38.46,lon:-98.25,name:'Central Kansas',method:'Example location',id:'example-kansas',boundary:null};
const validPoint = loc => loc && number(loc.lat) && number(loc.lon) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180;
const savedLocation = read('fieldshift.location', null);
const defaultEconomics = {currency:'USD',areaHa:1,yieldTonnesHa:3,pricePerTonne:350,seedCostHa:120,fertilizerCostHa:180,waterCostHa:80,operationsCostHa:220};
const state = {
  location:validPoint(savedLocation) ? savedLocation : {...example},
  preferences:read('fieldshift.preferences',{theme:'dark',units:'metric'}),
  fields:read('fieldshift.fields',[]),samples:read('fieldshift.samples',[]),journal:read('fieldshift.journal',[]),
  plans:read('fieldshift.plans',[]),weather:null,nasa:null,economics:null,rotationOptions:[],selectedPlan:'soil',
  weatherController:null,nasaController:null,searchController:null,requestId:0,route:'overview',map:null,ready:false,
  fieldSettings:read('fieldshift.fieldSettings',{}),
  economicsInputs:{...defaultEconomics}
};
let toastTimer;
let assistantFieldKey;
function toast(message) { text('#toast',message); $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'),3400); }
const icon = name => '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
const temperatureValue = n => state.preferences.units === 'imperial' ? n * 9 / 5 + 32 : n;
const temp = n => number(n) ? Math.round(temperatureValue(n))+'°'+(state.preferences.units === 'imperial'?'F':'C') : '—';
const rain = n => number(n) ? (state.preferences.units === 'imperial' ? (n/25.4).toFixed(2)+' in' : n.toFixed(1)+' mm') : '—';
const wind = n => number(n) ? (state.preferences.units === 'imperial' ? Math.round(n*0.621371)+' mph' : Math.round(n)+' km/h') : '—';
const money = (n, currency = state.economicsInputs.currency) => number(n) ? new Intl.NumberFormat('en',{style:'currency',currency,maximumFractionDigits:0}).format(n) : '—';
const moisture = n => number(n) ? (n*100).toFixed(0)+'%' : '—';
const dateShort = date => new Date(date+'T12:00:00').toLocaleDateString('en',{weekday:'short'});
const today = () => new Date().toISOString().slice(0,10);
const fieldKey = () => state.location.lat.toFixed(5)+','+state.location.lon.toFixed(5);
const total = (days,key) => days.length && days.every(d => number(d[key])) ? days.reduce((n,d) => n+d[key],0) : null;
const notifyFieldUpdate = () => window.dispatchEvent(new CustomEvent('fieldshift:updated'));
function persistFieldSettings(){
  state.fieldSettings[fieldKey()]={...state.fieldSettings[fieldKey()],economics:{...state.economicsInputs},planner:{crop:$('#current-crop').value,priority:$('#planning-priority').value,irrigation:$('#irrigation').value,ph:$('#planner-ph').value,selectedPlan:state.selectedPlan}};
  write('fieldshift.fieldSettings',state.fieldSettings);
}
function restoreFieldSettings(){
  const settings=state.fieldSettings[fieldKey()];
  state.economicsInputs={...defaultEconomics,...settings?.economics};
  if(state.location.boundary)state.economicsInputs.areaHa=Number(polygonAreaHa(state.location.boundary).toFixed(4));
  Object.entries(state.economicsInputs).forEach(([key,value])=>{if($('#economics-form').elements[key])$('#economics-form').elements[key].value=value;});
  const planner=settings?.planner??{};
  $('#current-crop').value=crops.some(c=>c.id===planner.crop)?planner.crop:'wheat';
  $('#planning-priority').value=planner.priority||'soil';$('#irrigation').value=planner.irrigation||'rainfed';$('#planner-ph').value=planner.ph??'';
  state.selectedPlan=planner.selectedPlan||'soil';state.weather=null;state.economics=null;
  renderEconomics();renderRotations();
}

function init() {
  replaceArrowGlyphs();
  const savedPlansPanel=document.createElement('article');savedPlansPanel.className='panel';
  savedPlansPanel.innerHTML='<div class="panel-heading"><div><span class="eyebrow">SAVED FOR THIS LAND</span><h2>Your rotation library</h2></div></div><div id="saved-plans-list"></div>';
  $('#view-crops').append(savedPlansPanel);
  $('[data-map-layer="terrain"]').textContent='Street map';
  state.map = createFieldMap($('#field-map'),{
    onSelect:point => selectLocation({...point,id:crypto.randomUUID(),name:'Selected point'},false),
    onBoundary:boundary => {
      state.location.boundary = boundary?.geometry ?? null;
      if (boundary) {
        // The reference point is a vertex-average center, not a polygon-wide environmental average.
        state.location.lat = boundary.centroid.lat; state.location.lon = boundary.centroid.lon;
        state.location.method = 'Drawn boundary'; state.location.id = crypto.randomUUID();
        state.location.name = $('#field-name-input').value.trim() || 'Mapped field';
        clearNasa();restoreFieldSettings();loadWeather();
        addJournal('Field boundary drawn',boundary.areaHa.toFixed(2)+' ha · entered geometry');
      }
      write('fieldshift.location',state.location); renderLocation(); toast(boundary?'Boundary drawn. Name and save your field.':'Boundary cleared');
    },
    onStatus:status => {text('#drawing-status',status.message);if(status.level==='error' && !status.message.includes('tiles'))toast(status.message);}
  });
  state.map.setLocation(state.location);
  if(state.location.boundary)state.map.setBoundary(state.location.boundary);
  bindEvents(); applyPreferences(); renderLocation(); renderSamples(); renderFields(); renderJournal();
  const cropOptions = crops.filter(c => c.type !== 'cover').map(c => '<option value="'+c.id+'">'+escapeHTML(c.name)+'</option>').join('');
  $('#current-crop').innerHTML = cropOptions;
  // Migrate earlier browser-local economics only to the field selected at upgrade.
  if(!Object.keys(state.fieldSettings).length){const legacy=read('fieldshift.economics',null);if(legacy)state.fieldSettings[fieldKey()]={economics:legacy};}
  restoreFieldSettings();
  $('#water-record-form').elements.date.value=today(); $('#soil-sample-form').elements.date.value=today();
  renderEconomics(); renderRotations(); renderCropLibrary(); renderReports(); renderAssistantEvidence();
  navigate(); window.addEventListener('hashchange',navigate);
  initPlanning({getState:()=>state,fieldKey,toast,crops});
  initScenes({getState:()=>state});
  loadWeather(); state.ready=true;
}

function navigate() {
  const candidate = location.hash.replace(/^#\/?/,'').split('?')[0] || 'overview';
  state.route = ['overview','map','weather','soil','water','crops','profit','reports','assistant','settings'].includes(candidate) ? candidate : 'overview';
  $$('.view').forEach(view => {view.hidden=view.id !== 'view-'+state.route;});
  $$('[data-route]').forEach(link => {const active=link.dataset.route===state.route;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  text('#route-name',({overview:'Overview',map:'Field explorer',weather:'Weather',soil:'Soil intelligence',water:'Water',crops:'Crop planner',profit:'Profit & scenarios',reports:'Reports',assistant:'Field assistant',settings:'Settings'})[state.route]);
  const target = state.route==='map'?$('#explorer-map-host'):$('#home-map-host');
  target.append($('#map-dock'));
  document.body.classList.remove('menu-open');
  requestAnimationFrame(() => state.map?.resize());
  if(state.ready)window.scrollTo({top:0,behavior:'instant'});
}

function bindEvents() {
  document.addEventListener('click',event => {
    const action = event.target.closest('[data-action]');
    if(!action)return;
    const actions = {
      menu:() => document.body.classList.toggle('menu-open'),
      'close-menu':() => document.body.classList.remove('menu-open'),
      location:() => $('#location-dialog').showModal(),
      'close-dialog':() => action.closest('dialog')?.close(),
      explore:() => {location.hash='/map';},
      theme:() => {state.preferences.theme=state.preferences.theme==='light'?'dark':'light';applyPreferences();},
      coordinates:useCoordinates,
      geolocation:useDeviceLocation,
      draw:() => {state.map.startDrawing();setMapModeButtons('map');},
      'finish-draw':() => state.map.finishDrawing(),
      'clear-boundary':() => state.map.clearBoundary(),
      'save-field':saveField,
      refresh:() => loadWeather(),
      'soil-dialog':() => $('#soil-dialog').showModal(),
      'compare-plans':() => {renderRotations();toast('Rotation comparisons updated');},
      'save-plan':savePlan,
      'export-csv':exportCSV,
      print:() => window.print(),
      nasa:loadNasa,
      'reset-location':() => {selectLocation({...example});toast('Example location restored');},
      backup:() => download('fieldshift-workspace.json',JSON.stringify({schemaVersion:3,fields:state.fields,location:state.location,samples:state.samples,journal:state.journal,plans:state.plans,fieldSettings:state.fieldSettings,seasons:read('fieldshift.seasons.v1',{})},null,2),'application/json')
    };
    try {actions[action.dataset.action]?.();} catch(error){toast(error.message);console.error(error);}
  });
  $$('[data-map-mode]').forEach(button => button.addEventListener('click',() => {state.map.setMode(button.dataset.mapMode);setMapModeButtons(button.dataset.mapMode);}));
  $$('[data-map-layer]').forEach(button => button.addEventListener('click',() => {state.map.setLayer(button.dataset.mapLayer);$$('[data-map-layer]').forEach(b => b.classList.toggle('selected',b===button));}));
  $('#place-search-form').addEventListener('submit',searchLocation);
  $('#geojson-import').addEventListener('change',importBoundary);
  $('#economics-form').addEventListener('submit',event => {event.preventDefault();state.fieldSettings[fieldKey()]={...state.fieldSettings[fieldKey()],economicsReviewed:true};renderEconomics();toast('Economics scenario updated');});
  $('#soil-sample-form').addEventListener('submit',saveSample);
  $('#water-record-form').addEventListener('submit',saveWater);
  $('#crop-filter').addEventListener('input',event => renderCropLibrary(event.target.value));
  $('#current-crop').addEventListener('change',renderRotations);
  $('#planning-priority').addEventListener('change',renderRotations);
  $('#irrigation').addEventListener('change',renderRotations);
  $('#planner-ph').addEventListener('change',renderRotations);
  $('#weather-units').addEventListener('change',event => {state.preferences.units=event.target.value;applyPreferences();if(state.weather)renderWeather();});
  $('#appearance').addEventListener('change',event => {state.preferences.theme=event.target.value;applyPreferences();});
  $('#chat-form').addEventListener('submit',event => {event.preventDefault();const input=event.target.elements.message;ask(input.value);input.value='';});
  $$('[data-question]').forEach(button => button.addEventListener('click',() => ask(button.dataset.question)));
  $$('.location-dialog-content').forEach(form => form.addEventListener('keydown',event => {if(event.key==='Escape')form.closest('dialog').close();}));
}
function setMapModeButtons(mode) {$$('[data-map-mode]').forEach(b => b.classList.toggle('selected',b.dataset.mapMode===mode));}
function applyPreferences() {
  document.body.classList.toggle('light',state.preferences.theme==='light');
  $('#appearance').value=state.preferences.theme;$('#weather-units').value=state.preferences.units;
  text('[data-temp-unit]',state.preferences.units==='imperial'?'°F':'°C');
  write('fieldshift.preferences',state.preferences);
}
function renderLocation() {
  const l=state.location;
  if(assistantFieldKey&&assistantFieldKey!==fieldKey()){
    const message=document.createElement('div');message.className='chat-message assistant-message';
    message.textContent='The active land has changed to '+l.name+'. Ask about the weather, soil records, crop paths, or economics for this location.';
    $('#chat-messages').replaceChildren(message);
  }
  assistantFieldKey=fieldKey();
  text('.field-picker>.eyebrow',l.method==='Example location'?'EXAMPLE LOCATION':'ACTIVE LOCATION');
  text('[data-field-name]',l.name);
  text('[data-coordinates]',Math.abs(l.lat).toFixed(4)+'° '+(l.lat>=0?'N':'S')+' · '+Math.abs(l.lon).toFixed(4)+'° '+(l.lon>=0?'E':'W'));
  text('#selection-type',l.method.toUpperCase());
  const area = l.boundary ? polygonAreaHa(l.boundary) : null;
  text('#field-area',area?area.toFixed(2)+' ha · drawn boundary':'Point selected · no boundary');
  text('#mapped-area',area?area.toFixed(2)+' ha / '+(area*2.47105).toFixed(2)+' acres':'No boundary drawn');
  text('#report-area',area?area.toFixed(2)+' hectares':'Point selection');
  $('#field-name-input').value=l.method==='Example location'?'':l.name;
  renderAssistantEvidence();renderReports();renderSamples();renderJournal();renderSavedPlans();notifyFieldUpdate();
}
function clearNasa(){
  state.nasaController?.abort();state.nasa=null;
  $('#nasa-result').innerHTML='<span class="empty">Load historical NASA context for the current selected location.</span>';
}
function selectLocation(point,move=true) {
  if(!validPoint(point))throw new Error('Please enter valid coordinates.');
  state.location={...point,boundary:point.boundary??null,id:point.id??crypto.randomUUID()};
  clearNasa();
  // A new point does not inherit a previous field’s geometry.
  state.map.clearBoundary();
  if(point.boundary) {state.location.boundary=point.boundary;state.map.setBoundary(point.boundary);}
  restoreFieldSettings();
  if(move)state.map.setLocation(point);
  write('fieldshift.location',state.location);renderLocation();loadWeather();
}
async function searchLocation(event) {
  event.preventDefault();state.searchController?.abort();state.searchController=new AbortController();
  const query=event.target.elements.query.value.trim();if(query.length<2)return;
  $('#search-results').innerHTML='<p class="search-results-status">Searching for places…</p>';
  try {
    const results=await searchPlaces(query,{signal:state.searchController.signal});
    $('#search-results').replaceChildren();
    if(!results.length){$('#search-results').innerHTML='<p class="search-results-status">No places found. Try a nearby town or enter coordinates.</p>';return;}
    for(const place of results){const button=document.createElement('button');button.type='button';button.className='search-result';button.innerHTML=escapeHTML(place.name)+'<small>'+place.lat.toFixed(4)+', '+place.lon.toFixed(4)+'</small>';button.addEventListener('click',() => {selectLocation({...place,method:'Place search'});$('#location-dialog').close();toast('Selected '+place.name);});$('#search-results').append(button);}
  }catch(error){if(error.name!=='AbortError')$('#search-results').innerHTML='<p class="search-results-status">'+escapeHTML(error.message)+'</p>';}
}
function useCoordinates(){const lat=$('#latitude-input').value.trim(),lon=$('#longitude-input').value.trim();if(!lat||!lon)return toast('Enter both latitude and longitude.');const point={lat:Number(lat),lon:Number(lon),name:'Coordinate selection',method:'Coordinates'};if(!validPoint(point))return toast('Latitude must be −90 to 90 and longitude −180 to 180.');selectLocation(point);$('#location-dialog').close();toast('Coordinates selected');}
function useDeviceLocation(){if(!navigator.geolocation)return toast('Location access is unavailable in this browser.');toast('Waiting for your location permission…');navigator.geolocation.getCurrentPosition(position=>{selectLocation({lat:position.coords.latitude,lon:position.coords.longitude,name:'My current location',method:'Device location'});$('#location-dialog').close();toast('Device location selected. Draw a boundary to map a field.');},error=>toast(error.code===1?'Location permission was declined. You can use search or coordinates.':'Could not retrieve location. Try search or coordinates.'),{enableHighAccuracy:false,timeout:15000,maximumAge:60000});}
async function importBoundary(event) {
  try {
    const file=event.target.files[0];if(!file)return;
    if(file.size>1000000)throw new Error('Use a GeoJSON file smaller than 1 MB.');
    const json=JSON.parse(await file.text());
    const geometry=validatePolygon(json.type==='FeatureCollection'?json.features?.[0]:json);
    const point=polygonReferencePoint(geometry);
    selectLocation({...point,name:file.name.replace(/\.(geojson|json)$/i,''),method:'Imported boundary',boundary:geometry});
    state.economicsInputs.areaHa=Number(polygonAreaHa(geometry).toFixed(4));
    $('#economics-form').elements.areaHa.value=state.economicsInputs.areaHa;
    renderEconomics();toast('Boundary imported. Verify its alignment on the map.');
  }catch(error){toast(error.message);}finally{event.target.value='';}
}
function saveField(){const name=$('#field-name-input').value.trim();if(!name)return toast('Give your field a name first.');state.location.name=name;const field={...state.location};const existing=state.fields.findIndex(f=>f.id===field.id);if(existing>=0)state.fields[existing]=field;else state.fields.push(field);write('fieldshift.fields',state.fields);write('fieldshift.location',state.location);renderFields();renderLocation();addJournal('Field saved',name);toast('Field saved in this browser');}
function renderFields(){const container=$('#saved-field-list');container.replaceChildren();if(!state.fields.length){container.innerHTML='<p class="empty">No saved fields yet.</p>';return;}for(const field of state.fields){const button=document.createElement('button');button.className='saved-field-button';button.innerHTML=escapeHTML(field.name)+'<small>'+(field.boundary?polygonAreaHa(field.boundary).toFixed(2)+' ha':'Point selection')+'</small>';button.addEventListener('click',()=>selectLocation({...field}));container.append(button);}}

async function loadWeather() {
  state.weatherController?.abort();state.weatherController=new AbortController();const request=++state.requestId;
  state.weather=null;resetWeather('loading');
  try {const weather=await fetchWeather(state.location,{signal:state.weatherController.signal});if(request!==state.requestId)return;state.weather=weather;renderWeather();renderRotations();}
  catch(error){if(error.name==='AbortError'||request!==state.requestId)return;resetWeather('error');text('[data-stat="conditions"]','Data unavailable');text('#connection-label','PROVIDER UNAVAILABLE');text('#home-forecast',error.message+' Use Refresh conditions on the Weather page to retry.');text('#full-forecast',error.message);text('[data-stat="provenance"]',error.message+' No sample values have been substituted.');}
  renderAssistantEvidence();renderReports();
}
function resetWeather(status){
  ['temperature','rainWeek','moisture','etWeek','feelsLike','humidity','wind','timezone','weatherTime','elevation','retrievalShort','retrievedAt'].forEach(key=>text('[data-stat="'+key+'"]','—'));
  text('[data-weather-status]',status==='loading'?'LOADING':'UNAVAILABLE');
  text('[data-stat="conditions"]',status==='loading'?'Fetching conditions…':'Unavailable');
  $('#home-forecast').innerHTML='<p class="empty">'+(status==='loading'?'Fetching the latest forecast…':'The data provider is unavailable.')+'</p>';
  $('#full-forecast').innerHTML='<p class="empty">'+(status==='loading'?'Loading seven-day outlook…':'Forecast unavailable.')+'</p>';
  $('#hourly-chart').innerHTML='<p class="empty">'+(status==='loading'?'Loading hourly data…':'Hourly data unavailable.')+'</p>';
  $('#water-chart').innerHTML='<p class="empty">'+(status==='loading'?'Loading water signals…':'Water signals unavailable.')+'</p>';
  renderReports();renderAssistantEvidence();notifyFieldUpdate();
}
function renderWeather(){
  const w=state.weather;if(!w)return;const c=w.current;
  text('[data-stat="temperature"]',temp(c.temperature));text('[data-stat="conditions"]',formatWeatherCode(c.weatherCode));
  text('[data-stat="moisture"]',moisture(c.soilMoisture));text('[data-stat="rainWeek"]',rain(total(w.daily,'rain')));text('[data-stat="etWeek"]',rain(total(w.daily,'et0')));
  text('[data-stat="feelsLike"]',temp(c.feelsLike));text('[data-stat="humidity"]',number(c.humidity)?c.humidity+'%':'—');text('[data-stat="wind"]',wind(c.wind));text('[data-stat="timezone"]',w.timezone);
  text('[data-stat="elevation"]',number(w.elevation)?Math.round(w.elevation)+' m · grid':'Unavailable');
  text('[data-stat="weatherTime"]','Valid '+(c.time?.replace('T',' ')??'time unavailable')+' · '+w.timezone);
  text('[data-stat="retrievedAt"]',new Date(w.retrievedAt).toLocaleString());text('[data-stat="retrievalShort"]',(w.cached?'Cached · ':'')+new Date(w.retrievedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
  text('[data-stat="provenance"]',(w.cached?'Cached retrieval · ':'')+'Open-Meteo · valid '+(c.time??'time unavailable')+' ('+w.timezone+') · retrieved '+new Date(w.retrievedAt).toLocaleString()+'. Current conditions and shallow moisture are model outputs.');
  text('[data-weather-status]',w.cached?'CACHED':'MODEL');text('#connection-label','LATEST DATA CONNECTED');
  const glyph = day => number(day.rain) && day.rain>1 ? '☂' : '◌';
  $('.weather-glyph').textContent=c.weatherCode===0?'☀':c.weatherCode>=51?'☂':'☁';
  $('#home-forecast').innerHTML=w.daily.slice(0,4).map((d,i)=>'<div class="forecast-item"><span class="forecast-date">'+(i===0?'Today':dateShort(d.date))+'</span><span>'+glyph(d)+'</span><span class="forecast-temp">'+temp(d.high)+'</span><span class="forecast-rain">'+rain(d.rain)+'</span></div>').join('');
  $('#full-forecast').innerHTML=w.daily.map((d,i)=>'<div class="day-card"><span class="day">'+(i===0?'Today':dateShort(d.date))+'</span><span class="wx">'+glyph(d)+'</span><strong>'+temp(d.high)+'<small>'+temp(d.low)+'</small></strong><span class="rain">'+rain(d.rain)+'</span></div>').join('');
  renderHourlyChart();renderWaterChart();renderReports();renderAssistantEvidence();notifyFieldUpdate();
}
function renderHourlyChart(){
  const w=state.weather;if(!w)return;
  const now=w.current.time??w.hourly[0]?.time;const points=w.hourly.filter(h=>h.time>=now).slice(0,24);
  const values=points.filter(p=>number(p.temperature)).map(p=>temperatureValue(p.temperature));if(!values.length){$('#hourly-chart').innerHTML='<p class="empty">Hourly values unavailable.</p>';return;}
  const min=Math.floor(Math.min(...values))-2,max=Math.ceil(Math.max(...values))+2,width=700,height=165,left=35,right=18,top=14,bottom=30;
  const x=i=>left+i*(width-left-right)/Math.max(1,points.length-1),y=n=>top+(max-n)/(max-min)*(height-top-bottom);
  let line='',inSegment=false;points.forEach((p,i)=>{if(!number(p.temperature)){inSegment=false;return;}line+=(inSegment?' L':' M')+x(i).toFixed(1)+' '+y(temperatureValue(p.temperature)).toFixed(1);inSegment=true;});
  const grid=[min,(min+max)/2,max].map(n=>'<path class="chart-grid" d="M'+left+' '+y(n)+'H'+(width-right)+'"/><text class="axis-label" x="1" y="'+(y(n)+3)+'">'+Math.round(n)+'°</text>').join('');
  const labels=points.filter((p,i)=>i%5===0).map(p=>{const i=points.indexOf(p);return '<text class="axis-label" x="'+x(i)+'" y="'+(height-5)+'" text-anchor="middle">'+p.time.slice(11,16)+'</text>';}).join('');
  $('#hourly-chart').innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Next 24 hours temperature chart in '+(state.preferences.units==='imperial'?'Fahrenheit':'Celsius')+'">'+grid+'<path class="temp-line" d="'+line+'"/>'+labels+'</svg>';
}
function renderWaterChart(){
  const days=state.weather?.daily;if(!days?.length)return;
  const vals=days.flatMap(d=>[d.rain,d.et0]).filter(number);if(!vals.length){$('#water-chart').innerHTML='<p class="empty">No water values returned.</p>';return;}
  const width=700,height=185,left=35,bottom=28,top=15,max=Math.max(2,...vals),step=(width-left-15)/days.length;
  const y=n=>height-bottom-n/max*(height-bottom-top);
  const grid=[0,max/2,max].map(v=>'<path class="chart-grid" d="M'+left+' '+y(v)+'H690"/><text class="axis-label" x="0" y="'+(y(v)+3)+'">'+(state.preferences.units==='imperial'?(v/25.4).toFixed(2):v.toFixed(1))+'</text>').join('');
  const bars=days.map((d,i)=>{const x=left+i*step+step/2;let shape='';if(number(d.rain))shape+='<rect x="'+(x-16)+'" y="'+y(d.rain)+'" width="13" height="'+(height-bottom-y(d.rain))+'" rx="2" fill="#7eb4b4" stroke="none"><title>'+d.date+' rain '+rain(d.rain)+'</title></rect>';if(number(d.et0))shape+='<rect x="'+(x+3)+'" y="'+y(d.et0)+'" width="13" height="'+(height-bottom-y(d.et0))+'" rx="2" fill="#c7b16c" stroke="none"><title>'+d.date+' ET0 '+rain(d.et0)+'</title></rect>';return shape+'<text class="axis-label" x="'+x+'" y="'+(height-4)+'" text-anchor="middle">'+dateShort(d.date)+'</text>';}).join('');
  $('#water-chart').innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Daily rainfall and reference evapotranspiration, '+(state.preferences.units==='imperial'?'inches':'millimeters')+'">'+grid+bars+'</svg>';
}

function renderRotations(){
  const ph=$('#planner-ph').value;
  const priority=$('#planning-priority').value==='resilience'?'risk':$('#planning-priority').value;
  state.rotationOptions=recommendRotations({priority,currentCrop:$('#current-crop').value||'wheat',irrigated:$('#irrigation').value==='irrigated',ph:ph===''?null:Number(ph),weather:state.weather});
  if(!state.rotationOptions.some(p=>p.id===state.selectedPlan))state.selectedPlan=state.rotationOptions[0]?.id;
  $('#rotation-plans').innerHTML=state.rotationOptions.map((plan,i)=>'<article class="rotation-plan '+(plan.id===state.selectedPlan?'selected':'')+'"><div class="plan-top"><span class="plan-number">PATH / 0'+(i+1)+'</span><span class="pill">'+(plan.id===state.selectedPlan?'SELECTED':'TRAIT SCREENING')+'</span></div><h2>'+escapeHTML(plan.name)+'</h2><div class="sequence">'+plan.sequence.map((id,j)=>(j?'<i>→</i>':'')+'<span>'+escapeHTML(crops.find(c=>c.id===id)?.name??id)+'</span>').join('')+'</div><ul>'+plan.reasons.map(reason=>'<li>'+escapeHTML(reason)+'</li>').join('')+'</ul><p class="plan-limit">'+escapeHTML(plan.limitations[0])+'</p><button class="button '+(plan.id===state.selectedPlan?'':'secondary')+'" data-select-plan="'+plan.id+'">'+(plan.id===state.selectedPlan?'Selected path':'Choose this path')+'</button></article>').join('');
  $$('[data-select-plan]').forEach(button=>button.addEventListener('click',()=>{state.selectedPlan=button.dataset.selectPlan;renderRotations();}));
  const plan=state.rotationOptions.find(p=>p.id===state.selectedPlan)??state.rotationOptions[0];
  const current=crops.find(c=>c.id===$('#current-crop').value)??crops[0];
  const steps=[{name:current.name,label:'CURRENT CROP',kind:current.family},...plan.sequence.slice(0,2).map((id,i)=>({name:crops.find(c=>c.id===id)?.name??id,label:'SEASON '+(i+1),kind:crops.find(c=>c.id===id)?.type??''}))];
  $('#rotation-preview').innerHTML=steps.map((c,i)=>(i?'<span class="rotation-arrow">→</span>':'')+'<div class="rotation-step"><span class="crop-symbol">'+(i?'♧':'♧')+'</span><span class="eyebrow">'+c.label+'</span><strong>'+escapeHTML(c.name)+'</strong><small>'+escapeHTML(c.kind)+'</small></div>').join('');
  persistFieldSettings();renderAssistantEvidence();notifyFieldUpdate();
}
function renderCropLibrary(filter=''){$('#crop-library').innerHTML=crops.filter(c=>(c.name+' '+c.family+' '+c.type).toLowerCase().includes(filter.toLowerCase())).map(c=>'<article class="crop-library-card"><span class="eyebrow">'+escapeHTML(c.family.toUpperCase())+'</span><h3>'+escapeHTML(c.name)+'</h3><p>'+escapeHTML(c.notes)+'</p><div class="crop-traits"><span>'+escapeHTML(c.season)+'</span><span>pH '+c.phMin+'–'+c.phMax+'</span><span>'+escapeHTML(c.waterDemand)+' demand</span></div><a href="'+escapeHTML(c.reference)+'" target="_blank" rel="noreferrer">FAO crop reference ↗</a></article>').join('')||'<p class="empty">No matching crops.</p>';replaceArrowGlyphs();}
function savePlan(){const plan=state.rotationOptions.find(p=>p.id===state.selectedPlan);if(!plan)return;state.plans.push({...plan,id:crypto.randomUUID(),pathId:plan.id,field:fieldKey(),location:{...state.location},savedAt:new Date().toISOString(),economics:{...state.economicsInputs},planner:{...state.fieldSettings[fieldKey()]?.planner}});write('fieldshift.plans',state.plans);addJournal('Rotation plan saved',plan.name);renderSavedPlans();notifyFieldUpdate();toast('Plan and assumptions saved in this browser');}
function renderSavedPlans(){
  const container=$('#saved-plans-list');if(!container)return;
  const entries=state.plans.filter(p=>p.field===fieldKey()).slice().reverse();container.replaceChildren();
  if(!entries.length){container.innerHTML='<p class="empty">No saved paths for this land yet. Choose a path above and save it with its assumptions.</p>';return;}
  for(const plan of entries){const row=document.createElement('div');row.className='sample-row';
    const content=document.createElement('div');const title=document.createElement('h3');title.textContent=plan.name;
    const details=document.createElement('p');details.textContent=(plan.sequence??[]).map(id=>crops.find(c=>c.id===id)?.name??id).join(' → ');
    const date=document.createElement('small');date.textContent='Saved '+new Date(plan.savedAt).toLocaleString();content.append(title,details,date);
    const actions=document.createElement('div');actions.className='button-row';const restore=document.createElement('button');restore.className='button secondary small';restore.textContent='Restore assumptions';
    restore.onclick=()=>{if(plan.field!==fieldKey())return;state.fieldSettings[fieldKey()]={...state.fieldSettings[fieldKey()],economics:{...plan.economics},planner:{...(plan.planner??{}),selectedPlan:plan.pathId??plan.id}};const weather=state.weather;restoreFieldSettings();state.weather=weather;renderRotations();renderWeather();renderReports();toast('Saved path assumptions restored to this land');};
    const remove=document.createElement('button');remove.className='button secondary small';remove.textContent='Remove';remove.onclick=()=>{if(plan.field!==fieldKey())return;state.plans=state.plans.filter(p=>p!==plan);write('fieldshift.plans',state.plans);renderSavedPlans();notifyFieldUpdate();toast('Saved path removed from this browser');};
    actions.append(restore,remove);row.append(content,actions);container.append(row);
  }
}
function renderEconomics(){
  text('#economics-status',state.fieldSettings[fieldKey()]?.economicsReviewed?'REVIEWED ASSUMPTIONS':'EXAMPLE ASSUMPTIONS · EDIT FOR YOUR LAND');
  try {const data=Object.fromEntries(new FormData($('#economics-form')));const inputs=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,key==='currency'?value:Number(value)]));state.economics=calculateEconomics(inputs);state.economicsInputs=inputs;persistFieldSettings();const e=state.economics;
    text('#profit-total',money(e.margin));text('#profit-per-ha',money(e.perHa.margin)+' per hectare · '+e.areaHa.toLocaleString()+' ha');text('[data-stat="margin"]',money(e.perHa.margin));text('#profit-revenue',money(e.revenue));text('#profit-cost',money(e.cost));text('#break-even-price',number(e.breakEvenPrice)?money(e.breakEvenPrice)+' / t':'Not defined at zero yield');text('#break-even-yield',number(e.breakEvenYield)?e.breakEvenYield.toFixed(2)+' t/ha':'Not defined at zero price');
    const max=Math.max(1,...e.scenarios.map(s=>Math.abs(s.margin)));
    $('#profit-scenarios').innerHTML=e.scenarios.map((s,i)=>'<div class="scenario-row"><span>'+escapeHTML(s.name)+'<small>'+(i===0?'Yield and price −10%':i===2?'Yield and price +10%':'Your entered yield and price')+'</small></span><div class="scenario-bar"><i style="width:'+Math.max(3,Math.abs(s.margin)/max*100)+'%"></i></div><strong>'+money(s.margin)+'</strong></div>').join('');renderReports();
  }catch(error){toast(error.message);}
}
function addJournal(title,detail){state.journal.unshift({id:crypto.randomUUID(),title,detail,field:fieldKey(),time:new Date().toISOString()});state.journal=state.journal.slice(0,100);write('fieldshift.journal',state.journal);renderJournal();}
function renderJournal(){const entries=state.journal.filter(e=>e.field===fieldKey()).slice(0,4);$('#journal-list').innerHTML=entries.length?entries.map(e=>'<div class="journal-entry"><i></i><div><b>'+escapeHTML(e.title)+'</b><small>'+escapeHTML(e.detail)+' · '+new Date(e.time).toLocaleDateString()+'</small></div><span>›</span></div>').join(''):'<div class="journal-empty">'+icon('leaf')+'<p>A new season starts with a first note. Save a field or add a soil sample to begin.</p><button class="button secondary small" data-action="soil-dialog">Add your first sample +</button></div>';}
function saveSample(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.target));if(data.ph===''&&data.carbon==='')return toast('Enter pH or organic carbon for this sample.');const record={...data,id:crypto.randomUUID(),field:fieldKey(),location:{lat:state.location.lat,lon:state.location.lon},ph:data.ph===''?null:Number(data.ph),carbon:data.carbon===''?null:Number(data.carbon),depth:Number(data.depth)};state.samples.push(record);write('fieldshift.samples',state.samples);addJournal('Soil sample added',record.name);renderSamples();$('#soil-dialog').close();event.target.reset();event.target.elements.date.value=today();toast('Sample saved to the selected field');}
function renderSamples(){
  const samples=state.samples.filter(s=>s.field===fieldKey());
  $('#soil-samples').innerHTML=samples.length?samples.map(s=>'<div class="sample-row"><div><h3>'+escapeHTML(s.name)+'</h3><p>pH '+(number(s.ph)?s.ph:'—')+' · Organic carbon '+(number(s.carbon)?s.carbon+'%':'—')+' · Depth '+s.depth+' cm</p><small>'+escapeHTML(s.date)+' · '+escapeHTML(s.method)+'</small></div><div class="button-row">'+(number(s.ph)?'<button class="button secondary small" data-use-sample="'+escapeHTML(s.id)+'">Use pH in planner</button>':'')+'<button data-delete-sample="'+escapeHTML(s.id)+'">Remove</button></div></div>').join(''):'<div class="journal-empty">'+icon('layers')+'<p>No measurements for this field yet. Add a dated sample from your own laboratory or field records.</p><button class="button secondary small" data-action="soil-dialog">Add a sample +</button></div>';
  $$('[data-use-sample]').forEach(button=>button.onclick=()=>{const sample=samples.find(s=>s.id===button.dataset.useSample);if(!sample||sample.field!==fieldKey())return;$('#planner-ph').value=sample.ph;renderRotations();location.hash='/crops';toast('Planner uses pH '+sample.ph+' from '+sample.name+' · '+sample.date);});
  $$('[data-delete-sample]').forEach(b=>b.addEventListener('click',()=>{state.samples=state.samples.filter(s=>s.id!==b.dataset.deleteSample||s.field!==fieldKey());write('fieldshift.samples',state.samples);renderSamples();toast('Sample removed from this device');}));
  renderAssistantEvidence();notifyFieldUpdate();
}
function saveWater(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.target));addJournal('Irrigation applied',Number(data.amount).toFixed(1)+' mm · '+data.date);toast('Irrigation record saved');event.target.elements.amount.value='';}

function evidenceRows(){const w=state.weather,c=w?.current;return [
  ['Air temperature',c?temp(c.temperature):'Unavailable','Current model analysis','Open-Meteo'],
  ['7-day rainfall',w?rain(total(w.daily,'rain')):'Unavailable','Forecast','Open-Meteo'],
  ['Surface moisture',c?moisture(c.soilMoisture):'Unavailable','Modeled 0–1 cm layer','Open-Meteo'],
  ['Gross margin / ha',state.economics?money(state.economics.perHa.margin):'Not calculated','Entered assumptions','Farmer scenario'],
  ['Selected point',state.location.lat.toFixed(4)+', '+state.location.lon.toFixed(4),state.location.method,'Your selection']
];}
function renderReports(){const body=$('#report-data');if(!body)return;body.innerHTML=evidenceRows().map(row=>'<tr>'+row.map(value=>'<td>'+escapeHTML(value)+'</td>').join('')+'</tr>').join('');notifyFieldUpdate();}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCSV(){const rows=[['FieldShift field intelligence report'],['Location',state.location.name],['Retrieved',state.weather?.retrievedAt??'Unavailable'],['Signal','Value','Evidence type','Source'],...evidenceRows()];download('fieldshift-report.csv',rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('Report downloaded');}
async function loadNasa(){state.nasaController?.abort();state.nasaController=new AbortController();const key=fieldKey();const container=$('#nasa-result');container.innerHTML='<p class="empty">Requesting historical NASA POWER data…</p>';try{const result=await fetchNasa(state.location,{signal:state.nasaController.signal});if(key!==fieldKey())return;state.nasa=result;const max=Math.max(1,...result.months.map(m=>m.rain??0));container.innerHTML='<span class="eyebrow">'+result.year+' MONTHLY RAINFALL · MM</span><div class="nasa-months">'+result.months.map(m=>'<div class="nasa-month" title="Month '+m.month+': '+(number(m.rain)?m.rain.toFixed(1)+' mm':'Unavailable')+'" style="height:'+(number(m.rain)?Math.max(2,m.rain/max*95):0)+'%"><span>'+m.month+'</span></div>').join('')+'</div><p class="fine-print">'+escapeHTML(result.limitations)+'</p><span class="eyebrow">NASA POWER · RETRIEVED '+new Date(result.retrievedAt).toLocaleDateString()+'</span>';notifyFieldUpdate();}catch(error){if(error.name!=='AbortError'&&key===fieldKey())container.innerHTML='<p class="empty">'+escapeHTML(error.message)+' You can retry using the button.</p>';}}
function renderAssistantEvidence(){const target=$('#assistant-evidence');if(!target)return;const rows=[['SELECTED PLACE',state.location.name],['WEATHER',state.weather?temp(state.weather.current.temperature)+' · '+formatWeatherCode(state.weather.current.weatherCode):'Not currently available'],['SURFACE MOISTURE',state.weather?moisture(state.weather.current.soilMoisture)+' · 0–1 cm model layer':'Not currently available'],['LOCAL SOIL SAMPLES',String(state.samples.filter(s=>s.field===fieldKey()).length)+' user records'],['GROSS MARGIN',state.economics?money(state.economics.perHa.margin)+' / ha · assumptions':'Not calculated']];target.innerHTML=rows.map(([name,value])=>'<div class="evidence-row"><small>'+escapeHTML(name)+'</small><strong>'+escapeHTML(value)+'</strong></div>').join('');}
function ask(question){question=question.trim();if(!question)return;const container=$('#chat-messages');const user=document.createElement('div');user.className='chat-message user-message';user.textContent=question;container.append(user);const answer=document.createElement('div');answer.className='chat-message assistant-message';answer.textContent=guidedAnswer(question);const source=document.createElement('small');source.textContent='Guided explanation from the visible field data. OpenAI is not connected.';answer.append(source);container.append(answer);container.scrollTop=container.scrollHeight;}
function guidedAnswer(question){const q=question.toLowerCase(),w=state.weather;let answer='';
  if(/soil|moisture|carbon|ph\b/.test(q)){const samples=state.samples.filter(s=>s.field===fieldKey());answer='For '+state.location.name+', '+(w?'the current shallow moisture estimate is '+moisture(w.current.soilMoisture)+'.':'a current soil-moisture estimate is unavailable. ')+ ' This describes a modeled 0–1 cm layer. It cannot establish deeper root-zone water, pH, texture, or nutrients. '+(samples.length?'You have '+samples.length+' dated soil record(s) for this field.':'A dated laboratory sample with depth and method would add useful evidence.');}
  else if(/profit|margin|price|cost|money|yield/.test(q)){const e=state.economics;answer=e?'The entered scenario has revenue of '+money(e.revenue)+' and costs of '+money(e.cost)+', leaving a gross margin of '+money(e.margin)+' over '+e.areaHa+' hectare(s). The break-even sale price is '+money(e.breakEvenPrice)+' per tonne. Land rent, tax, finance, and unentered costs are excluded. Compare the conservative price-and-yield case before relying on this estimate.':'Enter a yield, local sale price, area, and itemized costs in Profit & scenarios to calculate a transparent gross margin.';}
  else if(/rain|weather|water|irrigat|heat/.test(q)){answer=w?'At '+state.location.name+', the current model temperature is '+temp(w.current.temperature)+' and the seven-day forecast rain is '+rain(total(w.daily,'rain'))+'. Reference ET₀ is '+rain(total(w.daily,'et0'))+'. These figures help frame water questions, but irrigation decisions also need crop stage, rooting depth, soil storage, efficiency, and actual water access. Valid time: '+w.current.time+' ('+w.timezone+').':'Weather is unavailable for the current selection. Open the Weather page and refresh the provider before interpreting field conditions.';}
  else if(/crop|rotation|plant|season/.test(q)){const plan=state.rotationOptions.find(p=>p.id===state.selectedPlan);answer=plan?'The selected '+plan.name+' scenario considers '+plan.sequence.map(id=>crops.find(c=>c.id===id)?.name??id).join(' → ')+'. '+plan.reasons[0]+' This is broad crop-trait screening; a future planting decision needs regional variety, season, disease, soil-profile, and market information.':'Compare rotation paths in Crop planner after entering your current crop, water access, and known soil pH.';}
  else answer='For '+state.location.name+', the workspace has '+(w?'weather-model analysis and a seven-day forecast':'a selected location, while weather is unavailable')+', a crop-trait comparison, and the economics assumptions you entered. Missing evidence includes a laboratory soil profile, field crop history, local varieties and planting windows, actual irrigation supply, and a verified local sale price. I can explain the weather, soil moisture, crop paths, or margin when you ask about one of those.';
  return answer;
}

init();

function replaceArrowGlyphs() {
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())if(walker.currentNode.textContent.includes('↗'))nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement?.closest('script,style,svg'))continue;
    const parts=node.textContent.split('↗');const fragment=document.createDocumentFragment();
    parts.forEach((part,i)=>{if(i){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','inline-arrow');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6 18 18 6M6 6h12v12');svg.append(path);fragment.append(svg);}fragment.append(document.createTextNode(part));});node.replaceWith(fragment);
  }
}
