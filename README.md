# FieldShift 3.0 — Final edition

An interactive field operations workspace for the 2026 NASA Space Apps Challenge. The existing Site identity is preserved in `.openai/hosting.json`.

## Open the final website

Open **FieldShift-Final.html** in Chrome, Edge, or Firefox. This portable edition embeds the application, styles, logo, photo and map library in one file. Internet access is needed for live weather, satellite tiles, place search and NASA data. The file does not require a server, an API key, or a package installation. Mobile file previewers may not run JavaScript; open it in a full browser, or host the `dist` folder on a static web host.

The editable project is also included. Run `npm run dev` with Node 20+ to open it at `http://127.0.0.1:4173`. No dependencies are required to run the application. `npm run package:final` recreates the portable HTML in `release/` from the current source.

## What is new in this edition

- A rotating Earth opens the experience, holds for one second, then zooms past the camera and disappears. The final screen contains only the FieldShift title, a short caption, and the entry button. It can be replayed from Settings and follows English, French, and Arabic selections.

- Section-specific scenic backgrounds: selected-field weather controls the sky, sun/moon, cloud, rain and snow overlays; Water has ocean imagery and Soil has a forest backdrop. These decorative scenes stay inside their sections, retain contrast in both appearances, and respect reduced-motion preferences. An unavailable forecast clears the previous weather scene.

- Every selected coordinate has its own economics, crop-planner inputs, season schedule, scenario settings, soil records and observations. Returning to a field restores its records. A drawn/imported boundary supplies geometric area; changing land never transfers the previous field's yield or price assumptions.
- Saved rotation plans can be restored and removed for the selected field, with the assumptions they were saved with.
- Editable five-stage season timeline with planting date, stage durations and calendar dates. Durations are scheduling assumptions, not crop growth predictions.
- Forecast screening for heat, frost, heavy rain and strong wind, with visible rule thresholds and missing-data behavior.
- Temperature and rainfall sensitivity scenarios based on the selected point's forecast. Missing source values remain unavailable.
- Dated field notes and resized photo attachments, saved locally by field, with backup export and removal.
- Evidence completeness cards and a guided setup checklist. These distinguish user records, modeled values and planning assumptions.
- Printable field report including the selected rotation, economics assumptions, soil records, schedule, scenario and observations.
- Field selector accessible from every page; responsive phone and desktop layouts.

Save a workspace backup from Settings and a season/photo backup after adding records. Browser data is device-local; files opened from a different path or a different browser may have a separate storage area. The portable file includes no personal field records.

## Run locally

Requires Node 20+. The application is buildless and needs no runtime package installation.

```sh
npm run dev
# Open http://127.0.0.1:4173
npm run check
npm test
npm run test:final
```

For browser checks, install development dependencies (`npm install`) and Chromium (`npx playwright install chromium`), or use `/usr/bin/chromium`. Run `npm run test:browser` while the preview server is running. `FIELDSHIFT_PREVIEW` can select a different preview origin. Browser fixtures are restricted to automated tests; they are never shipped as environmental values.

## Working capabilities

- Ten hash routes with browser navigation, phone navigation, dark/daylight themes, and metric/imperial weather units.
- A shared selected point, optional device location, place search, manual coordinates, satellite map, and stationary interactive globe.
- Drawn or GeoJSON field boundaries, geodesic area, self-intersection validation, dateline-aware reference points, and local field persistence. The editor supports a single polygon outer ring, not holes or multipolygons.
- Seven-day weather, hourly temperatures, precipitation, reference ET0, and modeled 0–1 cm soil moisture. Requests cancel on location changes and failures remain unavailable.
- Dated user soil samples including collection depth and method, irrigation journal records, crop-trait rotation comparisons, and saved plans.
- Hectare/tonne economics with editable assumptions, currency labels, losses, break-even values, and sensitivity cases.
- CSV export, printable reports/PDF via the browser print dialog, a workspace JSON backup, and on-demand NASA POWER historical summaries.

## Data sources and interpretation

- [Open-Meteo](https://open-meteo.com/en/docs): current model analysis and seven-day forecasts, with valid time and retrieval time. In-memory same-coordinate weather cache is 15 minutes. Noncommercial provider terms apply; review licensing before commercial deployment.
- [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/): prior complete calendar year, summarized into monthly temperature, rain, and solar context. Coarse source grids are regional context, not field measurements. A single year is not a climate normal. Missing monthly rainfall remains unavailable.
- [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9): contextual satellite basemap with attribution displayed. Imagery does not claim a present acquisition date.
- OpenStreetMap contributors: optional cartographic basemap (the UI's alternative map layer).
- [FAO crop information](https://www.fao.org/land-water/databases-and-software/crop-information/en/): general crop references. The library is broad trait screening and requires regional validation.
- Landscape banner: [Unsplash photograph](https://images.unsplash.com/photo-1500382017468-9049fed747ef), used as an illustrative landscape, not as evidence about the selected place.
- Section imagery from Unsplash: [sea](https://images.unsplash.com/photo-1518837695005-2083093ee35b), [forest](https://images.unsplash.com/photo-1448375240586-882707db888b), [clear sky](https://images.unsplash.com/photo-1601297183305-6df142704ea2), [clouds](https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6), and [storm sky](https://images.unsplash.com/photo-1534088568595-a066f410bcda). Images are bundled locally and are illustrative, not imagery of the chosen field.
- MapLibre GL JS v5.6.1 and its CSS are vendored from the official distribution; see included license.

## Important boundaries

The application stores records on the current device. It has no account database or cross-device synchronization. A selected point uses the provider's reference grid. A drawn polygon gives geometric area; the application does not pretend to calculate a spatially aggregated soil/weather measurement over that polygon.

Soil pH/carbon values come only from user-entered samples. Regional SoilGrids property maps are not connected. Economics uses entered assumptions, not a live commodity feed; it excludes costs that were not entered. Rotation results explain broad trait rules and do not predict yield or certify suitability.

FieldShift focuses on field records, weather, water, soil, rotations, scenarios, and reports. No OpenAI service or secret is configured. No credentials are needed for the currently connected public data requests.

## Deployment

The static deployment directory is `dist`. Preserve the exact project ID and current private audience. Push the verified source state before packaging `.openai/hosting.json` and `dist` into a deployment archive. Use native Sites save/deploy operations for the same project. Source helper scripts are not installed in this workspace, so source pushes use ordinary Git with short-lived access supplied through stdin, never committed credentials.

## QA

The unit suite covers missing versus zero data, economics arithmetic, losses, crop constraints, provider errors, cancellation, NASA missing months, and geographic validation. The browser suite covers startup, ten routes, saved records, economics, guide responses, themes, and phone/desktop overflow. Additional live checks verified Open-Meteo, satellite tiles, globe rendering, and location request races.

The final browser suite additionally checks selected-field isolation/restoration for economics, crop planning, timelines, scenarios, notes and photo attachments, report content, unavailable source data, and desktop/mobile layouts. Provider fixtures are used only by tests, never by the shipped website.
