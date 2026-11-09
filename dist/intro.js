/** AgriPulse: a continuous, locally rendered journey from Earth to a growing plant. */
import { createPlantGrowth } from './growth.js';
const introCopy = {
  en: {
    title: 'AgriPulse', eyebrow: 'A bigger perspective. A better next season.',
    body: 'From a changing planet to the soil beneath your feet. Connect Earth observations, local weather and your own field knowledge to explore resilient crops, use water wisely, and plan what grows next.',
    enter: 'Enter AgriPulse', skip: 'Skip intro', replay: 'Replay introduction', replayBody: 'Take the journey from Earth to your next growing season again.',
    steps: ['Our planet', 'Your land', 'New possibilities'], orbit: 'Every field is part of something bigger.', land: 'A closer look at the land that matters.', grow: 'Better decisions. Stronger roots.', scroll: 'Built around your land'
  },
  fr: {
    title: 'AgriPulse', eyebrow: 'Une vision plus large. Une meilleure prochaine saison.',
    body: 'D’une planète en évolution au sol sous vos pieds. Reliez les observations de la Terre, la météo locale et votre connaissance du terrain pour explorer des cultures résilientes, préserver l’eau et préparer la prochaine saison.',
    enter: 'Entrer dans AgriPulse', skip: 'Passer l’introduction', replay: 'Revoir l’introduction', replayBody: 'Revivez le voyage de la Terre à votre prochaine saison agricole.',
    steps: ['Notre planète', 'Votre terre', 'De nouvelles possibilités'], orbit: 'Chaque champ fait partie d’un ensemble plus grand.', land: 'Regarder de plus près la terre qui compte.', grow: 'De meilleures décisions. Des racines plus fortes.', scroll: 'Pensé pour votre terre'
  },
  ar: {
    title: 'AgriPulse', eyebrow: 'رؤية أوسع. وموسم قادم أفضل.',
    body: 'من كوكب يتغير إلى التربة تحت قدميك. اربط رصد الأرض والطقس المحلي ومعرفتك بالحقل لاستكشاف محاصيل أكثر مرونة، وترشيد استخدام المياه، والتخطيط لما ستزرعه لاحقاً.',
    enter: 'دخول AgriPulse', skip: 'تخطي المقدمة', replay: 'إعادة المقدمة', replayBody: 'شاهد الرحلة من الأرض إلى موسمك الزراعي القادم مرة أخرى.',
    steps: ['كوكبنا', 'أرضك', 'فرص جديدة'], orbit: 'كل حقل جزء من عالم أكبر.', land: 'نظرة أقرب إلى الأرض التي تهمك.', grow: 'قرارات أفضل. وجذور أقوى.', scroll: 'مصمم حول أرضك'
  }
};

/** Texture-project a real Earth map onto a shaded sphere without a 3D dependency. */
function createEarthRenderer(canvas, fallback) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return { draw() {}, destroy() {} };
  const size = matchMedia('(max-width: 600px)').matches ? 320 : 512;
  canvas.width = canvas.height = size;
  const frame = context.createImageData(size, size);
  const pixels = frame.data;
  const rows = [];
  const radius = size / 2 - 2;
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - center) / radius;
      const ny = (y - center) / radius;
      const square = nx * nx + ny * ny;
      if (square >= 1) continue;
      const nz = Math.sqrt(1 - square);
      const latitude = Math.asin(Math.max(-1, Math.min(1, -ny)));
      const longitude = Math.atan2(nx, nz) / (2 * Math.PI);
      const sunlight = Math.max(0, nx * -0.48 + ny * -0.34 + nz * 0.8);
      const shade = 0.065 + Math.pow(sunlight, 0.8) * 1.07;
      const atmosphere = Math.pow(1 - nz, 4) * 0.42;
      rows.push({ at: (y * size + x) * 4, v: (0.5 - latitude / Math.PI), u: longitude, shade, atmosphere });
    }
  }
  let map = null;
  let width = 0;
  let height = 0;
  let disposed = false;
  const image = new Image();
  image.onload = () => {
    if (disposed) return;
    try {
      const surface = document.createElement('canvas');
      surface.width = width = 1024;
      surface.height = height = 512;
      const textureContext = surface.getContext('2d', { willReadFrequently: true });
      if (!textureContext) return;
      textureContext.drawImage(image, 0, 0, width, height);
      map = textureContext.getImageData(0, 0, width, height).data;
      fallback.hidden = true;
      canvas.classList.add('texture-ready');
    } catch { /* The CSS globe remains animated if a browser blocks canvas pixels. */ }
  };
  image.src = 'assets/earth-texture.jpg';
  return {
    draw(seconds) {
      if (!map || disposed) return;
      const rotation = 0.49 + seconds * 0.055;
      for (const pixel of rows) {
        const x = Math.floor(((pixel.u + rotation) % 1 + 1) % 1 * width);
        const y = Math.min(height - 1, Math.floor(pixel.v * height));
        const source = (y * width + x) * 4;
        const at = pixel.at;
        pixels[at] = Math.min(255, map[source] * pixel.shade + pixel.atmosphere * 42);
        pixels[at + 1] = Math.min(255, map[source + 1] * pixel.shade + pixel.atmosphere * 121);
        pixels[at + 2] = Math.min(255, map[source + 2] * pixel.shade + pixel.atmosphere * 226);
        pixels[at + 3] = 255;
      }
      context.putImageData(frame, 0, 0);
    },
    destroy() { disposed = true; image.onload = null; image.onerror = null; map = null; }
  };
}


export function initIntro({ language = 'en' } = {}) {
  let current = introCopy[language] ? language : 'en';
  let animationFrame = 0;
  let hideTimer = 0;
  let renderer = null;
  let plantRenderer = null;
  let startedAt = 0;
  let lastDraw = 0;
  let returnFocus = null;
  let opened = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lockedElements = new Map();
  const overlay = document.createElement('section');
  overlay.className = 'fieldshift-intro agripulse-intro';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'ap-intro-title');
  overlay.setAttribute('aria-describedby', 'ap-intro-description');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ap-space" aria-hidden="true"><div class="ap-starfield ap-stars-far"></div><div class="ap-starfield ap-stars-near"></div></div>
    <div class="ap-earth-stage" aria-hidden="true"><div class="ap-atmosphere"></div><div class="ap-earth-fallback"></div><canvas class="ap-earth-canvas"></canvas><div class="ap-earth-glint"></div></div>
    <div class="ap-landscape" aria-hidden="true"></div><div class="ap-dive-light" aria-hidden="true"></div>
    <header class="ap-intro-header"><div class="ap-intro-wordmark"><img src="assets/logo-new.png" alt=""><span>AgriPulse</span></div><button class="ap-intro-skip intro-skip" type="button"></button></header>
    <div class="ap-orbit-caption" aria-hidden="true"><span class="ap-coordinate">EARTH / 01</span><p></p></div>
    <div class="ap-plant-scene" aria-hidden="true">
      <div class="ap-plant-glow"></div>
      <canvas class="ap-plant-canvas"></canvas>
      <img class="ap-plant-photo" src="assets/intro-plant.jpg" alt="" decoding="async" fetchpriority="high">
      <div class="ap-macro-light"></div>
      <div class="ap-plant-particle ap-particle-one"></div><div class="ap-plant-particle ap-particle-two"></div><div class="ap-plant-particle ap-particle-three"></div>
      <span class="ap-plant-note">EARTH OBSERVATIONS → NEW POSSIBILITIES</span>
    </div>
    <div class="ap-intro-copy" inert><span class="ap-intro-eyebrow"></span><h1 id="ap-intro-title">AgriPulse<span>.</span></h1><p id="ap-intro-description"></p><button type="button" class="ap-intro-enter earth-intro-enter"><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button><span class="ap-intro-small"></span></div>
    <footer class="ap-intro-footer"><div class="ap-journey-steps" aria-hidden="true"><span><i>01</i><b></b></span><span><i>02</i><b></b></span><span><i>03</i><b></b></span></div><div class="ap-journey-line" aria-hidden="true"><i></i></div></footer>
    <p class="ap-intro-status sr-only" role="status" aria-live="polite"></p>`;
  document.body.append(overlay);
  const enter = overlay.querySelector('.ap-intro-enter');
  const skip = overlay.querySelector('.ap-intro-skip');
  const content = overlay.querySelector('.ap-intro-copy');
  const status = overlay.querySelector('.ap-intro-status');
  const caption = overlay.querySelector('.ap-orbit-caption p');
  const row = document.createElement('div');
  row.className = 'setting-item intro-replay-setting';
  row.innerHTML = '<div><b></b><p></p></div><button type="button" class="button secondary small"></button>';
  document.querySelector('.settings-panel')?.append(row);

  function applyCopy() {
    const words = introCopy[current];
    overlay.dir = current === 'ar' ? 'rtl' : 'ltr';
    overlay.lang = current;
    overlay.querySelector('.ap-intro-eyebrow').textContent = words.eyebrow;
    overlay.querySelector('#ap-intro-description').textContent = words.body;
    overlay.querySelector('.ap-intro-enter span').textContent = words.enter;
    overlay.querySelector('.ap-intro-small').textContent = words.scroll;
    skip.textContent = words.skip;
    overlay.querySelectorAll('.ap-journey-steps b').forEach((step, index) => { step.textContent = words.steps[index]; });
    row.querySelector('b').textContent = words.replay;
    row.querySelector('p').textContent = words.replayBody;
    row.querySelector('button').textContent = words.replay;
    const phase = overlay.dataset.introStage;
    caption.textContent = phase === 'orbit' ? words.orbit : phase === 'land' ? words.land : words.grow;
  }

  function halt() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    renderer?.destroy();
    renderer = null;
    plantRenderer?.destroy();
    plantRenderer = null;
  }

  function lockPage(lock) {
    if (lock) {
      for (const element of document.body.children) {
        if (element === overlay || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') continue;
        if (!lockedElements.has(element)) lockedElements.set(element, element.inert);
        element.inert = true;
      }
    } else {
      lockedElements.forEach((wasInert, element) => { element.inert = wasInert; });
      lockedElements.clear();
    }
  }

  function setStage(stage) {
    if (overlay.dataset.introStage === stage) return;
    overlay.dataset.introStage = stage;
    const words = introCopy[current];
    caption.textContent = stage === 'orbit' ? words.orbit : stage === 'land' ? words.land : words.grow;
    status.textContent = stage === 'orbit' ? words.orbit : stage === 'land' ? words.land : stage === 'ready' ? words.eyebrow : words.grow;
    if (stage === 'ready') {
      content.inert = false;
      overlay.classList.add('ap-revealed', 'revealed');
      if (document.activeElement === skip || document.activeElement === overlay) enter.focus({ preventScroll: true });
    }
  }

  function close() {
    if (!opened) return;
    opened = false;
    halt();
    try { sessionStorage.setItem('agripulse.intro.seen.growth.v1', '1'); sessionStorage.setItem('fieldshift.intro.skip-auto', '1'); } catch { /* Entry works with browser storage disabled. */ }
    overlay.classList.add('leaving');
    document.body.classList.remove('intro-open', 'intro-pending');
    lockPage(false);
    hideTimer = setTimeout(() => { overlay.hidden = true; }, reducedMotion.matches ? 0 : 360);
    const focusTarget = returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : document.querySelector('.topbar-field, .menu-button, .brand');
    focusTarget?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('fieldshift:intro:closed'));
  }

  function tick(now) {
    if (!opened) return;
    const elapsed = now - startedAt;
    if (elapsed >= 2200) overlay.classList.add('ap-diving', 'zooming');
    if (elapsed >= 3000 && elapsed < 3900) { overlay.classList.add('ap-land'); setStage('land'); }
    if (elapsed >= 3900 && elapsed < 8000) { overlay.classList.add('ap-land', 'ap-growing'); setStage('grow'); }
    if (elapsed >= 8000) {
      overlay.classList.add('ap-land', 'ap-growing');
      setStage('ready');
    }
    if (now - lastDraw >= 40) {
      if (elapsed < 3800) renderer?.draw(elapsed / 1000);
      else if (renderer) { renderer.destroy(); renderer = null; }
      if (elapsed >= 3900) plantRenderer?.draw((elapsed - 3900) / 1000);
      lastDraw = now;
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function open() {
    halt();
    clearTimeout(hideTimer);
    if (!opened) returnFocus = document.activeElement;
    opened = true;
    overlay.hidden = false;
    overlay.classList.remove('leaving', 'ap-running', 'ap-diving', 'ap-land', 'ap-growing', 'ap-revealed', 'ap-static', 'zooming', 'revealed');
    delete overlay.dataset.introStage;
    content.inert = true;
    document.body.classList.add('intro-open', 'intro-pending');
    lockPage(true);
    applyCopy();
    void overlay.offsetWidth;
    if (reducedMotion.matches) {
      overlay.classList.add('ap-static', 'ap-land', 'ap-growing');
      setStage('ready');
      enter.focus({ preventScroll: true });
      return;
    }
    overlay.classList.add('ap-running');
    setStage('orbit');
    const fallback = overlay.querySelector('.ap-earth-fallback');
    fallback.hidden = false;
    overlay.querySelector('.ap-earth-canvas').classList.remove('texture-ready');
    try { renderer = createEarthRenderer(overlay.querySelector('.ap-earth-canvas'), fallback); } catch { renderer = null; }
    const plantScene = overlay.querySelector('.ap-plant-scene');
    plantScene.classList.remove('ap-photo-ready');
    try { plantRenderer = createPlantGrowth(overlay.querySelector('.ap-plant-canvas'), plantScene); } catch { plantRenderer = null; }
    startedAt = performance.now();
    lastDraw = 0;
    skip.focus({ preventScroll: true });
    animationFrame = requestAnimationFrame(tick);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button')].filter(button => !button.closest('[inert]') && button.getClientRects().length);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  function onLanguage(event) { current = introCopy[event.detail] ? event.detail : 'en'; applyCopy(); }
  function onMotionChange() {
    if (!opened || !reducedMotion.matches) return;
    halt();
    overlay.classList.add('ap-static', 'ap-land', 'ap-growing');
    setStage('ready');
  }
  enter.addEventListener('click', close);
  skip.addEventListener('click', close);
  row.querySelector('button').addEventListener('click', open);
  overlay.addEventListener('keydown', onKeydown);
  window.addEventListener('fieldshift:language', onLanguage);
  reducedMotion.addEventListener('change', onMotionChange);
  window.addEventListener('pagehide', halt);
  window.addEventListener('pageshow', event => { if (event.persisted && opened) open(); });
  applyCopy();
  let seen = false;
  try { seen = sessionStorage.getItem('agripulse.intro.seen.growth.v1') === '1'; } catch { /* No-storage visits can still use the introduction. */ }
  if (!seen) open();
  else document.body.classList.remove('intro-pending');
  return { open, close };
}
