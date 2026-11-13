/** Geographic selection and field boundaries. All GeoJSON coordinates use [longitude, latitude]. */
const RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
const EMPTY = () => ({ type: 'FeatureCollection', features: [] });
const feature = (geometry, properties = {}) => ({ type: 'Feature', properties, geometry });
const finiteCoordinate = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
function longitudeDelta(a, b) { return ((b - a + 540) % 360) - 180; }
function unwrap(ring) {
  let longitude = ring[0][0];
  return ring.map((p, i) => { if (i) longitude += longitudeDelta(ring[i - 1][0], p[0]); return [longitude, p[1]]; });
}
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += longitudeDelta(ring[i][0], ring[i + 1][0]) * RAD * (2 + Math.sin(ring[i][1] * RAD) + Math.sin(ring[i + 1][1] * RAD));
  return Math.abs(sum * RADIUS_M * RADIUS_M / 2);
}
/** Spherical geodesic area of the entered geometry; precision is limited by the boundary supplied. */
export function polygonAreaHa(input) {
  const geometry = input?.type === 'Feature' ? input.geometry : input;
  if (geometry?.type !== 'Polygon' || !geometry.coordinates?.length) return 0;
  let area = ringArea(geometry.coordinates[0]);
  for (const hole of geometry.coordinates.slice(1)) area -= ringArea(hole);
  return Math.max(0, area / 10000);
}
function direction(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a, b, p) { return p[0] >= Math.min(a[0], b[0]) - 1e-12 && p[0] <= Math.max(a[0], b[0]) + 1e-12 && p[1] >= Math.min(a[1], b[1]) - 1e-12 && p[1] <= Math.max(a[1], b[1]) + 1e-12; }
function intersect(a, b, c, d) {
  const da = direction(a, b, c), db = direction(a, b, d), dc = direction(c, d, a), dd = direction(c, d, b);
  if (((da > 0 && db < 0) || (da < 0 && db > 0)) && ((dc > 0 && dd < 0) || (dc < 0 && dd > 0))) return true;
  return (Math.abs(da) < 1e-12 && onSegment(a, b, c)) || (Math.abs(db) < 1e-12 && onSegment(a, b, d)) || (Math.abs(dc) < 1e-12 && onSegment(c, d, a)) || (Math.abs(dd) < 1e-12 && onSegment(c, d, b));
}
export function validatePolygon(input) {
  const geometry = input?.type === 'Feature' ? input.geometry : input;
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new Error('Please provide a GeoJSON Polygon.');
  if (geometry.coordinates.reduce((n, ring) => n + ring.length, 0) > 2000) throw new Error('Please simplify this boundary to fewer than 2,000 vertices.');
  for (const ring of geometry.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(finiteCoordinate) || !samePoint(ring[0], ring[ring.length - 1])) throw new Error('Boundary rings need three or more valid vertices and a closed final point.');
    if (new Set(ring.slice(0, -1).map(p => p.join(','))).size < 3) throw new Error('Select at least three different points.');
    const points = unwrap(ring);
    for (let i = 0; i < points.length - 1; i++) for (let j = i + 1; j < points.length - 1; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 2)) continue;
      if (intersect(points[i], points[i + 1], points[j], points[j + 1])) throw new Error('The boundary crosses itself. Undo or redraw the crossing edges.');
    }
  }
  if (geometry.coordinates.length > 1) throw new Error('This field editor supports a single outer boundary. Remove inner holes before importing.');
  if (polygonAreaHa(geometry) < 0.0001) throw new Error('The boundary is too small or its points lie on one line.');
  return geometry;
}
function centerOf(geometry) {
  const points = unwrap(geometry.coordinates[0].slice(0, -1));
  let lon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  lon = ((lon + 540) % 360) - 180;
  return { lon, lat: points.reduce((sum, p) => sum + p[1], 0) / points.length };
}
/** A stable reference coordinate (mean boundary vertices), not an area-weighted field centroid. */
export function polygonReferencePoint(input) { return centerOf(validatePolygon(input)); }

export function createFieldMap(container, { onSelect = () => {}, onBoundary = () => {}, onStatus = () => {} } = {}) {
  const target = typeof container === 'string' ? document.getElementById(container) : container;
  let map, ready = false, destroyed = false, mode = 'map', layer = 'satellite', boundary = null, selected = null, drawing = false, vertices = [], pendingModeCamera = false;
  const status = (message, level = 'info') => onStatus({ message, level, drawing, pointCount: vertices.length });
  const unavailable = message => {
    if (target) {
      const box = document.createElement('div'); box.className = 'map-fallback'; box.style.cssText = 'padding:32px;min-height:260px;display:grid;place-content:center;text-align:center;color:#b9cbbd;background:#122019;';
      const title = document.createElement('strong'); title.textContent = 'Map unavailable on this device';
      const text = document.createElement('p'); text.textContent = message + ' You can still select a location with search or coordinates.';
      box.append(title, text); target.replaceChildren(box);
    }
    status(message, 'error');
  };
  const update = () => {
    if (!ready || destroyed) return;
    map.getSource('field-boundary')?.setData(boundary ? feature(boundary) : EMPTY());
    map.getSource('field-selection')?.setData(selected ? feature({ type: 'Point', coordinates: [selected.lon, selected.lat] }) : EMPTY());
    const preview = EMPTY();
    if (vertices.length >= 2) preview.features.push(feature({ type: 'LineString', coordinates: vertices }));
    if (vertices.length >= 3) preview.features.push(feature({ type: 'Polygon', coordinates: [[...vertices, vertices[0]]] }));
    for (const p of vertices) preview.features.push(feature({ type: 'Point', coordinates: p }));
    map.getSource('field-drawing')?.setData(preview);
  };
  function applyMode() { if (ready) map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' }); }
  function frameMode() {
    if (!map || !ready) { pendingModeCamera = true; return; }
    pendingModeCamera = false;
    const current = map.getCenter();
    const center = selected ? [selected.lon, Math.max(-85, Math.min(85, selected.lat))] : [current.lng, current.lat];
    map.easeTo({ center, zoom: mode === 'globe' ? 1.35 : 8.7, pitch: 0, bearing: 0, duration: 420, essential: false });
  }
  function applyLayer() {
    if (!ready) return;
    map.setLayoutProperty('satellite-base', 'visibility', layer !== 'terrain' ? 'visible' : 'none');
    map.setLayoutProperty('terrain-base', 'visibility', layer === 'terrain' ? 'visible' : 'none');
    map.setLayoutProperty('thermal-base', 'visibility', layer === 'thermal' ? 'visible' : 'none');
  }
  function finishDrawing() {
    if (!drawing) return null;
    try {
      const points = vertices.filter((p, i) => i === 0 || !samePoint(p, vertices[i - 1]));
      if (points.length >= 2 && samePoint(points[0], points[points.length - 1])) points.pop();
      const geometry = validatePolygon({ type: 'Polygon', coordinates: [[...points, points[0]]] });
      boundary = geometry; drawing = false; vertices = [];
      if (map) { map.getCanvas().style.cursor = ''; map.doubleClickZoom.enable(); }
      const payload = { geometry, areaHa: polygonAreaHa(geometry), centroid: centerOf(geometry) };
      selected = { ...payload.centroid }; update();
      onBoundary(payload); status('Field boundary saved. ' + payload.areaHa.toFixed(2) + ' hectares within the entered boundary.');
      return payload;
    } catch (error) { status(error.message, 'error'); return null; }
  }
  const api = {
    setLocation(location) {
      if (!finiteCoordinate([location?.lon, location?.lat])) { status('Use valid latitude and longitude.', 'error'); return; }
      const alreadySelected = selected && Math.abs(selected.lat - location.lat) < 1e-8 && Math.abs(selected.lon - location.lon) < 1e-8;
      selected = { lat: location.lat, lon: location.lon }; update();
      if (map && !alreadySelected) map.easeTo({ center: [location.lon, Math.max(-85, Math.min(85, location.lat))], zoom: Math.min(9, Math.max(map.getZoom(), 7.5)), duration: 420, essential: false });
    },
    setMode(next) { mode = next === 'globe' ? 'globe' : 'map'; if (drawing && mode === 'globe') api.cancelDrawing(); applyMode(); frameMode(); },
    setLayer(next) { layer = ['terrain', 'thermal'].includes(next) ? next : 'satellite'; applyLayer(); },
    startDrawing() {
      if (!map || !ready) { status('Wait for the map to load before drawing.', 'error'); return; }
      mode = 'map'; applyMode(); drawing = true; vertices = []; map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; update();
      status('Click around the field edge. Finish with the save boundary button or a double click.');
    },
    finishDrawing,
    cancelDrawing() { drawing = false; vertices = []; if (map) { map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; } update(); status('Boundary drawing cancelled.'); },
    clearBoundary() { boundary = null; vertices = []; drawing = false; if (map) { map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; } update(); onBoundary(null); status('Boundary removed. The selected coordinate remains a point.'); },
    setBoundary(input) { try { boundary = validatePolygon(input); update(); return true; } catch (error) { status(error.message, 'error'); return false; } },
    resize() { map?.resize(); },
    destroy() { destroyed = true; ready = false; map?.remove(); map = null; }
  };
  try {
    if (!globalThis.maplibregl || (typeof globalThis.maplibregl.supported === 'function' && !globalThis.maplibregl.supported())) { unavailable('WebGL rendering is unavailable.'); return api; }
    map = new globalThis.maplibregl.Map({
      container: target,
      style: {
        version: 8,
        sources: {
          'satellite-raster': { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{x}/{y}.jpeg'], tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS / Blue Marble shaded relief' },
          'terrain-raster': { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/SRTM_Color_Index/default/GoogleMapsCompatible_Level12/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, attribution: 'NASA SRTM elevation' },
          'thermal-raster': { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/GoogleMapsCompatible_Level9/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 9, attribution: 'Vegetation index: NASA GIBS / MODIS Terra NDVI' }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#07120e' } },
          { id: 'satellite-base', type: 'raster', source: 'satellite-raster', paint: { 'raster-saturation': -0.1, 'raster-brightness-max': 0.9 } },
          { id: 'terrain-base', type: 'raster', source: 'terrain-raster', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.3 } },
          { id: 'thermal-base', type: 'raster', source: 'thermal-raster', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } }
        ]
      },
      center: [18, 23], zoom: 1.8, maxZoom: 12, attributionControl: true, antialias: false,
      fadeDuration: 0, refreshExpiredTiles: false, maxTileCacheSize: 64, cooperativeGestures: false,
      scrollZoom: false, dragRotate: false, touchPitch: false
    });
    map.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.on('load', () => {
      if (destroyed) return;
      for (const name of ['field-boundary', 'field-selection', 'field-drawing']) map.addSource(name, { type: 'geojson', data: EMPTY() });
      map.addLayer({ id: 'field-fill', type: 'fill', source: 'field-boundary', paint: { 'fill-color': '#b7ed72', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'field-edge', type: 'line', source: 'field-boundary', paint: { 'line-color': '#c9f48b', 'line-width': 2.5 } });
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'field-drawing', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#cdf294', 'fill-opacity': 0.16 } });
      map.addLayer({ id: 'draft-edge', type: 'line', source: 'field-drawing', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#d9efac', 'line-width': 2, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'draft-points', type: 'circle', source: 'field-drawing', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#eff8d9', 'circle-stroke-color': '#28482d', 'circle-stroke-width': 1 } });
      map.addLayer({ id: 'selected-halo', type: 'circle', source: 'field-selection', paint: { 'circle-radius': 15, 'circle-color': '#c9f48b', 'circle-opacity': 0.16 } });
      map.addLayer({ id: 'selected-point', type: 'circle', source: 'field-selection', paint: { 'circle-radius': 6, 'circle-color': '#c9f48b', 'circle-stroke-color': '#102519', 'circle-stroke-width': 2 } });
      ready = true; applyMode(); applyLayer(); update(); if (pendingModeCamera) frameMode(); status('Map ready. Select a point or draw a field boundary.');
    });
    map.on('click', event => {
      const point = [event.lngLat.wrap().lng, event.lngLat.lat];
      if (drawing) { if (vertices.length < 500) vertices.push(point); update(); status(vertices.length + ' boundary vertices. Continue drawing or save boundary.'); return; }
      selected = { lon: point[0], lat: point[1] }; update();
      onSelect({ ...selected, name: 'Selected location', method: mode === 'globe' ? 'Globe' : 'Map' });
    });
    map.on('dblclick', event => { if (drawing) { event.preventDefault(); finishDrawing(); } });
    const reportedTileErrors = new Set();
    map.on('error', event => {
      const errorKey = event.sourceId || layer;
      if (reportedTileErrors.has(errorKey)) return;
      reportedTileErrors.add(errorKey);
      status('Some map tiles could not load. Try another layer or select a place using search.', 'error');
    });
  } catch (error) { map?.remove(); map = null; unavailable('The map renderer could not start.'); }
  return api;
}
