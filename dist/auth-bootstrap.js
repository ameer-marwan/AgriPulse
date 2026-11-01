const api = '/api';
const gate = document.querySelector('#auth-gate');
const status = gate.querySelector('[data-auth-status]');
const guestButton = gate.querySelector('[data-auth-guest]');
const signInLinks = gate.querySelectorAll('[data-auth-signin]');
const copy = {
  en:{eyebrow:'YOUR FIELD. YOUR WORKSPACE.',title:'How would you like to continue?',body:'Create an account to keep your fields, plans, soil records and reports safely available when you return.',login:'Log in',signup:'Create account',guest:'Continue as guest',guestNote:'Guest data lasts only for this browser tab and is not saved to an account.',secure:'Secure sign-in and email verification are handled by ChatGPT.',loading:'Checking your account…',error:'Account service is temporarily unavailable. You can still continue as a guest.',guestChip:'Guest mode',accountChip:'Account',saveCloud:'Cloud-synced workspace',saveCloudBody:'Your fields, journal records and assumptions are saved securely to your account.',saveGuest:'Guest workspace',saveGuestBody:'Your work lasts only for this tab. Sign in to keep it.'},
  fr:{eyebrow:'VOTRE CHAMP. VOTRE ESPACE.',title:'Comment souhaitez-vous continuer ?',body:'Créez un compte pour retrouver vos champs, plans, analyses du sol et rapports lors de votre prochaine visite.',login:'Se connecter',signup:'Créer un compte',guest:'Continuer en invité',guestNote:'Les données invité restent uniquement dans cet onglet et ne sont pas enregistrées dans un compte.',secure:'La connexion sécurisée et la vérification de l’adresse e-mail sont gérées par ChatGPT.',loading:'Vérification de votre compte…',error:'Le service de compte est temporairement indisponible. Vous pouvez continuer en invité.',guestChip:'Mode invité',accountChip:'Compte',saveCloud:'Espace synchronisé dans le cloud',saveCloudBody:'Vos champs, journaux et hypothèses sont enregistrés en toute sécurité dans votre compte.',saveGuest:'Espace invité',saveGuestBody:'Votre travail reste uniquement dans cet onglet. Connectez-vous pour le conserver.'},
  ar:{eyebrow:'حقلك. مساحة عملك.',title:'كيف تريد المتابعة؟',body:'أنشئ حساباً للاحتفاظ بالحقول والخطط وسجلات التربة والتقارير والعودة إليها لاحقاً.',login:'تسجيل الدخول',signup:'إنشاء حساب',guest:'المتابعة كضيف',guestNote:'تدوم بيانات الضيف في علامة التبويب هذه فقط ولا تُحفظ في حساب.',secure:'يتولى ChatGPT تسجيل الدخول الآمن والتحقق من البريد الإلكتروني.',loading:'جارٍ التحقق من حسابك…',error:'خدمة الحساب غير متاحة مؤقتاً. يمكنك المتابعة كضيف.',guestChip:'وضع الضيف',accountChip:'الحساب',saveCloud:'مساحة عمل متزامنة سحابياً',saveCloudBody:'تُحفظ حقولك وسجلاتك وافتراضاتك بأمان في حسابك.',saveGuest:'مساحة عمل الضيف',saveGuestBody:'يبقى عملك في علامة التبويب هذه فقط. سجّل الدخول للاحتفاظ به.'}
};
function language(){
  for(const store of [sessionStorage,localStorage])try{const value=JSON.parse(store.getItem('fieldshift.preferences'));if(copy[value?.language])return value.language;}catch{}
  return copy[navigator.language?.slice(0,2)]?navigator.language.slice(0,2):'en';
}
const words=copy[language()];
for(const [key,value] of Object.entries(words))gate.querySelectorAll(`[data-copy="${key}"]`).forEach(el=>el.textContent=value);
signInLinks.forEach(link=>link.href='/signin-with-chatgpt?return_to=/');
let started=false, syncTimer;
const fieldKeys=store=>Object.keys(store).filter(key=>key.startsWith('fieldshift.')&&!key.includes('intro.skip-auto'));
const snapshot=store=>Object.fromEntries(fieldKeys(store).map(key=>[key,store.getItem(key)]));
function accountStorage(){
  return {getItem:key=>localStorage.getItem(key),setItem(key,value){localStorage.setItem(key,value);scheduleSync();},removeItem(key){localStorage.removeItem(key);scheduleSync();}};
}
async function sync(){
  const response=await fetch(api+'/workspace',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data:snapshot(localStorage)})});
  if(!response.ok)throw new Error('Workspace sync failed');
  window.dispatchEvent(new CustomEvent('fieldshift:sync',{detail:{state:'saved'}}));
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(()=>window.dispatchEvent(new CustomEvent('fieldshift:sync',{detail:{state:'error'}}))),700);}
async function start(mode,user){
  if(started)return;started=true;
  window.__fieldshiftAccount=user||null;
  window.__fieldshiftStorage=mode==='guest'?sessionStorage:accountStorage();
  gate.classList.add('leaving');setTimeout(()=>gate.hidden=true,360);
  await import('./app.js');
  addAccountControl(mode,user);
}
function addAccountControl(mode,user){
  const top=document.querySelector('.topbar-right');if(!top)return;
  const control=document.createElement(mode==='account'?'a':'button');
  control.className='auth-chip';
  if(mode==='account'){control.href='/signout-with-chatgpt?return_to=/';control.target='_top';control.title='Sign out';control.innerHTML=`<span></span><b>${escapeHTML(user.email)}</b><small>Sign out</small>`;}
  else{control.type='button';control.innerHTML=`<span></span><b>${words.guestChip}</b><small>${words.signup}</small>`;control.onclick=()=>location.assign('/signin-with-chatgpt?return_to=/');}
  top.prepend(control);
  const setting=[...document.querySelectorAll('.setting-item')].find(item=>item.querySelector('b')?.textContent.includes('Device-local'));
  if(setting){setting.querySelector('b').textContent=mode==='account'?words.saveCloud:words.saveGuest;setting.querySelector('p').textContent=mode==='account'?words.saveCloudBody:words.saveGuestBody;setting.querySelector('.pill').textContent=mode==='account'?'SYNCED':'SESSION';}
}
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
guestButton.onclick=()=>{sessionStorage.setItem('fieldshift.guest','1');start('guest');};
async function boot(){
  status.textContent=words.loading;
  if(location.protocol==='file:'||((location.hostname==='127.0.0.1'||location.hostname==='localhost')&&!new URLSearchParams(location.search).has('auth-preview'))){await start('guest');return;}
  try{
    const response=await fetch(api+'/me',{credentials:'same-origin'});if(!response.ok)throw new Error();
    const identity=await response.json();
    if(!identity.authenticated){status.textContent='';gate.classList.add('ready');return;}
    const saved=await fetch(api+'/workspace',{credentials:'same-origin'});const payload=saved.ok?await saved.json():{data:{}};
    const cloud=payload.data||{};const guest=snapshot(sessionStorage);const merged=Object.keys(cloud).length?cloud:{...snapshot(localStorage),...guest};
    fieldKeys(localStorage).forEach(key=>localStorage.removeItem(key));for(const [key,value] of Object.entries(merged))if(key.startsWith('fieldshift.')&&typeof value==='string')localStorage.setItem(key,value);
    await start('account',identity);if(!Object.keys(cloud).length&&Object.keys(merged).length)scheduleSync();
  }catch{status.textContent=words.error;gate.classList.add('ready');}
}
boot();
