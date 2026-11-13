# 🌱 AgriPulse — your intelligent agricultural assistant

> **From Earth observation to better field decisions.**

AgriPulse is an interactive agricultural decision workspace created for the **2026 NASA Space Apps Challenge**. It brings location, weather, Earth-observation layers, soil notes, water context, crop planning, transparent economics, and printable reports into one farmer-friendly experience.

## 🚀 Try AgriPulse

**[Open the public AgriPulse preview →](https://fieldshift-two.vercel.app/)**

![AgriPulse field view](dist/assets/field-landscape.jpg)

## ✨ What AgriPulse does

- 🗺️ Search for a city or farm by name, enter coordinates, use device location, or select a point on the map.
- 🌍 Explore satellite maps and an interactive 3D globe with NASA Earth-observation layers.
- ☀️ See current modeled weather and a short forecast with animated sun, clouds, rain, snow, fog, and night scenes.
- 💧 Review recent rainfall and water context without presenting historical records as a forecast.
- 🪨 Record local soil samples, depth, collection method, texture, pH, and drainage.
- 🌾 Compare crop profiles and plan rotations while keeping assumptions visible.
- 📈 Calculate transparent economics from entered yield, price, cost, loss, transport, and market-fee assumptions.
- 📝 Keep field notes, observations, irrigation records, and photos attached to the selected field.
- 📄 Export reports, CSV data, printable PDF, or workspace JSON backups.
- 🌐 Use the guided Simple farmer flow or the full Complex farmer workspace.
- 🌙 Switch between daylight, forest dark, and automatic themes.

## 🧭 Two ways to work

### Simple farmer

1. **Location** — search a place, enter coordinates, use your location, or open the map.
2. **Soil & water** — enter only what you know; optional values stay clearly marked.
3. **Crops** — choose crop profiles with friendly emoji markers and practical context.
4. **Report** — review weather, rainfall, soil details, water context, crop screening, and planning margin.

### Complex farmer

The full workspace adds the field explorer, layer controls, boundary drawing, weather, soil intelligence, water, crop planner, profit scenarios, reports, evidence, feedback, and settings.

## 🛰️ Data sources and evidence

AgriPulse separates **live modeled forecasts**, **historical regional context**, **map imagery**, and **farmer-entered evidence**. It never substitutes invented values when a provider fails.

### Connected public sources

- [NASA POWER](https://power.larc.nasa.gov/) — regional temperature, rainfall, humidity, wind, and solar records.
- [NASA GIBS / Worldview](https://worldview.earthdata.nasa.gov/) — Blue Marble, MODIS/VIIRS, SRTM, GPM/IMERG, and SMAP map layers.
- [Open-Meteo forecast API](https://open-meteo.com/en/docs) — current modeled conditions and short-range forecast used for the live weather scene.
- [Open-Meteo geocoding](https://geocoding-api.open-meteo.com/) — place-name search and coordinates.

### NASA Space Apps resource directory

The in-app Resources page links to the official challenge resources, including:

🔹 [SMAP](https://www.earthdata.nasa.gov/data/instruments/smap) · [GPM / IMERG](https://gpm.nasa.gov/data) · [Landsat](https://landsat.gsfc.nasa.gov/data/) · [MODIS / VIIRS](https://worldview.earthdata.nasa.gov/) · [NASA POWER](https://power.larc.nasa.gov/) · [SRTM](https://www.earthdata.nasa.gov/data/instruments/srtm) · [ECOSTRESS](https://ecostress.jpl.nasa.gov/) · [GEDI](https://gedi.umd.edu/)

🔹 [USDA Ag Data Commons](https://agdatacommons.nal.usda.gov/) · [Web Soil Survey](https://websoilsurvey.nrcs.usda.gov/) · [CropScape / CDL](https://nassgeodata.gmu.edu/CropScape/) · [SSURGO](https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo) · [NAIP](https://www.fsa.usda.gov/programs-and-services/aerial-photography/imagery-programs/naip-imagery/) · [USDA NASS QuickStats](https://quickstats.nass.usda.gov/) · [USDA AMS Market News](https://www.ams.usda.gov/market-news)

🔹 [USGS NLCD](https://www.usgs.gov/centers/eros/science/national-land-cover-database) · [USGS NWIS](https://waterdata.usgs.gov/nwis) · [NLDAS / GLDAS](https://search.earthdata.nasa.gov/) · [PRISM](https://prism.oregonstate.edu/) · [OpenET](https://openetdata.org/) · [LANDFIRE](https://landfire.gov/) · [FAO GAEZ](https://gaez.fao.org/) · [CoCoRaHS](https://www.cocorahs.org/) · [Copernicus Sentinel-2](https://dataspace.copernicus.eu/explore-data/data-collections/sentinel-data/sentinel-2) · [ERA5](https://www.ecmwf.int/en/forecasts/dataset/ecmwf-reanalysis-v5)

Some resources require provider accounts, API keys, licensing, or extra processing before they can safely become live numerical inputs. The interface labels those as resources rather than pretending they are connected.

## 👥 About the team

AgriPulse was built by a student technology team exploring how NASA Earth data can support clearer agricultural decisions.

- 👨‍💻 **Ahmed** — [GitHub](https://github.com/a7mdel5taeeb-eng)
- 🛰️ **Ameer** — [GitHub](https://github.com/ameer-marwan)
- 🔧 **Mostafa** — [GitHub](https://github.com/mostafabass1)

## 🛠️ Run locally

Requires **Node.js 22.13+**.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

Useful checks:

```bash
npm run check
npm test
```

The local server stores local account/workspace data in `.local/fieldshift.sqlite`. Do not commit that directory.

## 🔐 Data honesty and limitations

- Weather and Earth-observation values are model or regional-grid outputs, not field sensors.
- A drawn boundary calculates geometric area; it does not create a spatially averaged soil measurement.
- Soil pH, soil texture, irrigation access, crop history, prices, yields, and costs come from the farmer unless an explicitly connected provider supplies them.
- Profit is a planning estimate based on entered assumptions, not a guaranteed market result.
- Crop profiles are screening references and do not replace local agronomy or extension advice.
- Provider outages remain visible; AgriPulse does not silently insert sample values.

## 📚 Credits

AgriPulse uses official NASA, USDA, USGS, FAO, ESA/Copernicus, Open-Meteo, MapLibre, and other linked public resources. External providers retain their own terms and attribution requirements.

Built with care for the **NASA Space Apps Challenge** 🌍🌾
