# AgriPulse data sources

AgriPulse currently uses **NASA POWER Daily API** for numerical regional climate context: recent and previous-year temperature, precipitation, humidity, wind, and solar values. These are historical grid records, not live weather, a forecast, or field measurements. The profit calculations use farmer-entered prices, yields, and costs.

The Field Explorer displays **NASA GIBS** imagery: Blue Marble base imagery, SRTM terrain, MODIS Terra NDVI, GPM IMERG precipitation rate, and SMAP L4 modeled surface soil moisture. These are visual map layers only. AgriPulse does not sample pixel values from them or feed them into crop, water, or profit calculations. Map tiles may be unavailable for some locations or dates.

All other resources in the challenge document are links in the About Us directory, not integrated data feeds. In particular, AgriPulse does not currently calculate field suitability from USDA SSURGO/Web Soil Survey, crop history from CDL, or field vegetation indices from Landsat or Sentinel-2. Some sources have geographic coverage limits, registration requirements, or data licenses. The interface leaves unsupported values unavailable rather than inventing them.

The public GitHub repository and published Site must be kept at the same source revision for source audits to describe the live app accurately.
