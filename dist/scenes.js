/** Decorative section imagery; the scene follows the selected point's WMO code. */
export function weatherScene(current) {
  const code = current?.weatherCode;
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'unknown';
  if ([95, 96, 99].includes(code)) return 'storm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([45, 48].includes(code)) return 'fog';
  if (code === 3) return 'cloudy';
  if ([0, 1, 2].includes(code) && current.isDay === false) return 'night';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  return 'unknown';
}

export function initScenes({ getState }) {
  for (const name of ['weather', 'water', 'soil']) {
    const view = document.getElementById('view-' + name);
    const backdrop = document.createElement('div');
    backdrop.className = 'section-scene';
    backdrop.setAttribute('aria-hidden', 'true');
    view.prepend(backdrop);
  }
  const weather = document.getElementById('view-weather');
  const atmosphere = document.createElement('div');
  atmosphere.className = 'weather-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  atmosphere.innerHTML = '<div class="scene-orb"></div><div class="scene-cloud cloud-one"></div><div class="scene-cloud cloud-two"></div><div class="scene-particles"></div>';
  weather.querySelector('.weather-feature').prepend(atmosphere);
  for (const name of ['water', 'soil']) {
    const caption = document.createElement('span');
    caption.className = 'section-scene-caption';
    caption.textContent = 'ILLUSTRATIVE ' + (name === 'water' ? 'SEASCAPE' : 'FOREST');
    document.querySelector('#view-' + name + ' .page-heading').append(caption);
  }
  const update = () => {
    const current = getState().weather?.current;
    const scene = weatherScene(current);
    weather.dataset.weatherScene = scene;
    weather.classList.remove('weather-clear','weather-partly','weather-cloudy','weather-rain','weather-storm','weather-fog','weather-snow','weather-night','weather-unknown');
    weather.classList.add('weather-' + scene);
    atmosphere.dataset.weatherScene = scene;
    // Scene descriptions come from the existing conditions text, so decoration
    // stays silent for assistive technology and never substitutes for evidence.
    const glyph = document.querySelector('.weather-glyph');
    if (glyph) glyph.textContent = ({ clear:'☀', partly:'☁', cloudy:'☁', fog:'≋', rain:'☂', snow:'❄', storm:'ϟ', night:'☾', unknown:'◌' })[scene];
  };
  window.addEventListener('fieldshift:updated', update);
  update();
}
