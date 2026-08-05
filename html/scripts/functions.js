const { default: SunCalc } = await import('https://cdn.skypack.dev/suncalc@1.8.0');
const { default: WidgetAPI } = await import('https://widget.cdn.septima.dk/latest/widgetapi.mjs')
const { renderEclipsePreview } = await import('./preview.js');

let SolarEclipse = null;
let Catalogue = null;
let Location = null;

async function loadAstronomyBundleEclipse() {
  // This app runs as static browser ESM, so use CDN modules directly.
  const [solarEclipseMod, catalogueMod, coreMod] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/@astronomy-bundle/solar-eclipse/+esm'),
    import('https://cdn.jsdelivr.net/npm/@astronomy-bundle/solar-eclipse/catalogue/+esm'),
    import('https://cdn.jsdelivr.net/npm/@astronomy-bundle/core/+esm'),
  ]);

  SolarEclipse = solarEclipseMod.SolarEclipse;
  Catalogue = catalogueMod.Catalogue;
  Location = coreMod.Location;
}

await loadAstronomyBundleEclipse();

const mapConfigUrl = new URL('./config/map.json', document.baseURI).href;
const widget = new WidgetAPI('.widgetmap', mapConfigUrl)

function getCssPxVar(name, fallback) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const mapWrapperSize = getCssPxVar('--map-wrapper-size', 960);
const mapPieSize = getCssPxVar('--map-pie-size', 860);
const mapPieRadius = getCssPxVar('--map-pie-radius', 410);
const mapSliderRadius = getCssPxVar('--map-slider-radius', 420);

const config = {
  radius: mapPieRadius,
  pieCenter: mapPieSize / 2,
  wrapperSize: mapWrapperSize,
  sliderRadius: mapSliderRadius,
  sliderStep: 0.05,
  latlongCoords: [12.539792090268461, 55.70698126629835], // Rådhuspladsen coordinates for initial view. Beware that im not sure the coordinates are in the correct order
  sliderOffset: 45, // The slider is turned by 45 degress so we add this to account for the offset
  rotationAdjustment: 180, // Not entirely sure why, but the rotation is usually flipped, so we need to turn it 180 deg. to re-flip it
  circleLength: Math.PI * (mapPieRadius * 2), // Circumference
  defaultDate: '2026-08-12',
  defaultTime: '20:00', // Lokal dansk tid for solformørkelsens toppunkt
  mapCenter: [724282.08, 6178621.15], // EPSG:25832
  mapZoom: 11,
};

function formatMinutesToClock(totalMinutes) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

const danishTimeFormatter = new Intl.DateTimeFormat('da-DK', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Europe/Copenhagen',
});

const eclipseCache = new Map();

function timeOfInterestToDate(toi) {
  if (!toi) return null;

  if (typeof toi.getDate === 'function') {
    const value = toi.getDate();
    if (value instanceof Date) return value;
  }

  if (typeof toi.toDate === 'function') {
    const value = toi.toDate();
    if (value instanceof Date) return value;
  }

  if (typeof toi.getTime === 'function') {
    const time = toi.getTime();
    if (time && Number.isFinite(time.year)) {
      const sec = Number.isFinite(time.sec) ? time.sec : 0;
      const seconds = Math.floor(sec);
      const ms = Math.round((sec - seconds) * 1000);
      return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1, time.hour || 0, time.min || 0, seconds, ms));
    }
  }

  return null;
}

function formatDateToDanishClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  // formatToParts avoids locale separators like '.' and guarantees HH:MM:SS.
  const parts = danishTimeFormatter.formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const second = parts.find((part) => part.type === 'second')?.value;

  if (!hour || !minute || !second) return null;
  return `${hour}:${minute}:${second}`;
}

function parseLocalClockToParts(localTimeStr) {
  const normalized = String(localTimeStr || '').trim().replace(/\./g, ':');
  const [rawH, rawM, rawS] = normalized.split(':');
  const hours = Number(rawH);
  const minutes = Number(rawM);
  const seconds = Number(rawS ?? 0);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return { hours, minutes, seconds };
}

function normalizeClockString(rawValue, includeSeconds = false) {
  const cleaned = String(rawValue || '').trim().replace(/\./g, ':');
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3] || '0', 10);

  if (
    !Number.isInteger(hours)
    || !Number.isInteger(minutes)
    || !Number.isInteger(seconds)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
    || seconds < 0
    || seconds > 59
  ) {
    return null;
  }

  if (includeSeconds) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatLocalClock(dateValue, includeSeconds = false) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return null;

  const hours = String(dateValue.getHours()).padStart(2, '0');
  const minutes = String(dateValue.getMinutes()).padStart(2, '0');

  if (!includeSeconds) {
    return `${hours}:${minutes}`;
  }

  const seconds = String(dateValue.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function updateEclipsePreview(_eclipse, localTimeStr) {
  const previewCanvas = document.getElementById('eclipse-preview-canvas');
  const altitudeNode = document.getElementById('sun-altitude-readout');
  const azimuthNode = document.getElementById('sun-azimuth-readout');
  const overlapNode = document.getElementById('sun-overlap-readout');
  if (!previewCanvas || !config.latlongCoords) return;

  const preview = renderEclipsePreview(previewCanvas, {
    lngLat: config.latlongCoords,
    date: dateControl.value,
    time: String(localTimeStr || config.defaultTime),
    timeZone: 'Europe/Copenhagen',
  });

  if (preview?.sun) {
    if (altitudeNode) altitudeNode.innerText = `alt ${preview.sun.altitude.toFixed(1)}°`;
    if (azimuthNode) azimuthNode.innerText = `az ${preview.sun.azimuth.toFixed(1)}°`;
    if (overlapNode) overlapNode.innerText = `overlap ${((preview.exactCoverage ?? preview.coverage) * 100).toFixed(1)}%`;
    console.log('Preview sun altitude:', {
      time: String(localTimeStr || config.defaultTime),
      lngLat: config.latlongCoords,
      sunAltitudeDeg: Number(preview.sun.altitude.toFixed(3)),
      sunAzimuthDeg: Number(preview.sun.azimuth.toFixed(3)),
      overlapPct: Number((((preview.exactCoverage ?? preview.coverage) * 100)).toFixed(3)),
    });
  } else {
    if (altitudeNode) altitudeNode.innerText = 'alt --.-°';
    if (azimuthNode) azimuthNode.innerText = 'az --.-°';
    if (overlapNode) overlapNode.innerText = 'overlap --.-%';
  }
}

function getCurrentPreviewTime() {
  return (document.getElementById('slider-time')?.value || '').trim();
}

function getSolarEclipseByDateAndLngLat(dateStr, lngLat) {
  const [lng, lat] = lngLat;
  const key = `${dateStr}::${lat.toFixed(6)}::${lng.toFixed(6)}`;

  if (eclipseCache.has(key)) {
    return eclipseCache.get(key);
  }

  try {
    const elements = Catalogue.getBesselianElements(dateStr);
    const eclipse = SolarEclipse.createFromBesselianElements(elements);
    const location = Location.create(lat, lng, 0);
    const localEclipse = eclipse.getLocalEclipse(location);
    const contacts = localEclipse.getContactTimes();

    const c1 = timeOfInterestToDate(contacts.c1);
    const max = timeOfInterestToDate(contacts.max);
    const c4 = timeOfInterestToDate(contacts.c4);

    const startLocal = formatDateToDanishClock(c1);
    const peakLocal = formatDateToDanishClock(max);
    const endLocal = formatDateToDanishClock(c4);

    const startMinutes = startLocal ? parseInt(startLocal.slice(0, 2), 10) * 60 + parseInt(startLocal.slice(3, 5), 10) : null;
    const peakMinutes = peakLocal ? parseInt(peakLocal.slice(0, 2), 10) * 60 + parseInt(peakLocal.slice(3, 5), 10) : null;
    const endMinutes = endLocal ? parseInt(endLocal.slice(0, 2), 10) * 60 + parseInt(endLocal.slice(3, 5), 10) : null;

    const result = {
      date: dateStr,
      startLocal,
      peakLocal,
      endLocal,
      obscurationPct: Number((localEclipse.getMaxObscuration() * 100).toFixed(2)),
      maxMoonSunRatio: localEclipse.getMaxMoonSunRatio(),
      startMinutes,
      peakMinutes,
      endMinutes,
      type: localEclipse.getType(),
    };

    eclipseCache.set(key, result);
    return result;
  } catch (error) {
    console.warn('No solar eclipse data found for date/location.', dateStr, lngLat, error);
    const result = {
      date: dateStr,
      startLocal: null,
      peakLocal: null,
      endLocal: null,
      obscurationPct: 0,
      maxMoonSunRatio: null,
      startMinutes: null,
      peakMinutes: null,
      endMinutes: null,
      type: 'none',
    };
    eclipseCache.set(key, result);
    return result;
  }
}

function getSolarEclipse2026ForLngLat(lngLat) {
  return getSolarEclipseByDateAndLngLat(config.defaultDate, lngLat);
}

// window.getSolarEclipse2026ForLngLat = getSolarEclipse2026ForLngLat;

function getEclipseTimeByTarget(eclipse, target) {
  if (!eclipse) return null;
  if (target === 'start') return eclipse.startLocal;
  if (target === 'peak') return eclipse.peakLocal;
  if (target === 'end') return eclipse.endLocal;
  return null;
}

function bindEclipseTimeButtons() {
  const buttons = document.querySelectorAll('.eclipse-time-btn');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.eclipseTarget;
      const eclipse = config.eclipse;
      const localTime = getEclipseTimeByTarget(eclipse, target);
      if (!localTime) return;

      syncTimeInputToSliderAndClock(localTime, dateControl.value, config.latlongCoords);
    });
  });
}

function bindTimeInput() {
  const timeInput = document.getElementById('slider-time');

  if (!timeInput) return;

  const normalizeTimeInputValue = (rawValue) => {
    const trimmed = String(rawValue || '').trim().replace(/\./g, ':');
    if (!trimmed) return null;

    const directMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    let hours;
    let minutes;

    if (directMatch) {
      hours = Number.parseInt(directMatch[1], 10);
      minutes = Number.parseInt(directMatch[2], 10);
    } else if (/^\d{3,4}$/.test(trimmed)) {
      // allow bare 4-digit entry like "2000" → "20:00"
      const digits = trimmed.padStart(4, '0');
      hours = Number.parseInt(digits.slice(0, 2), 10);
      minutes = Number.parseInt(digits.slice(2, 4), 10);
    } else {
      return null;
    }

    if (
      !Number.isInteger(hours)
      || !Number.isInteger(minutes)
      || hours < 0
      || hours > 23
      || minutes < 0
      || minutes > 59
    ) {
      return null;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const sanitizeDraftTimeValue = (rawValue) => {
    // strip anything that isn't a digit or colon while typing
    const cleaned = String(rawValue || '').replace(/\./g, ':').replace(/[^\d:]/g, '');
    const firstColonIndex = cleaned.indexOf(':');

    if (firstColonIndex === -1) {
      return cleaned.slice(0, 2);
    }

    const hours = cleaned.slice(0, firstColonIndex).replace(/:/g, '').slice(0, 2);
    const minutes = cleaned.slice(firstColonIndex + 1).replace(/:/g, '').slice(0, 2);
    return `${hours}:${minutes}`;
  };

  let lastValidTime = normalizeTimeInputValue(timeInput.value) || config.defaultTime;
  timeInput.value = lastValidTime;

  timeInput.addEventListener('input', () => {
    const sanitized = sanitizeDraftTimeValue(timeInput.value);
    if (sanitized !== timeInput.value) {
      timeInput.value = sanitized;
    }
  });

  const commitTimeChange = () => {
    const normalized = normalizeTimeInputValue(timeInput.value);

    if (!normalized) {
      // revert to last known good value
      timeInput.value = lastValidTime;
      return;
    }

    timeInput.value = normalized;

    if (normalized === lastValidTime) return;

    lastValidTime = normalized;

    if (config.latlongCoords) {
      syncTimeInputToSliderAndClock(normalized, dateControl.value, config.latlongCoords);
    }
  };

  timeInput.addEventListener('change', commitTimeChange);
  timeInput.addEventListener('blur', commitTimeChange);
}

function renderEclipseInfo(eclipse) {
  const startNode = document.getElementById('eclipse-start');
  const peakNode = document.getElementById('eclipse-peak');
  const endNode = document.getElementById('eclipse-end');
  const percentageNode = document.getElementById('eclipse-percentage');
  const startButton = document.querySelector('.eclipse-time-btn[data-eclipse-target="start"]');
  const peakButton = document.querySelector('.eclipse-time-btn[data-eclipse-target="peak"]');
  const endButton = document.querySelector('.eclipse-time-btn[data-eclipse-target="end"]');

  if (!startNode || !peakNode || !endNode || !percentageNode) return;

  startNode.innerText = eclipse.startLocal || '--:--';
  peakNode.innerText = eclipse.peakLocal || '--:--';
  endNode.innerText = eclipse.endLocal || '--:--';

  if (startButton) startButton.disabled = !eclipse.startLocal;
  if (peakButton) peakButton.disabled = !eclipse.peakLocal;
  if (endButton) endButton.disabled = !eclipse.endLocal;

  if (Number.isFinite(eclipse.obscurationPct) && eclipse.obscurationPct > 0) {
    percentageNode.innerText = `${eclipse.obscurationPct.toFixed(1)}%`;
  } else {
    percentageNode.innerText = '--.-%';
  }

  updateEclipsePreview(eclipse, getCurrentPreviewTime());
}

function updateEclipseEstimateForCurrentLocation() {
  const eclipse = getSolarEclipseByDateAndLngLat(config.defaultDate, config.latlongCoords);
  config.eclipse = eclipse;
  renderEclipseInfo(eclipse);
  console.log('Eclipse estimate for location:', config.latlongCoords, eclipse);
  return eclipse;
}

function syncLocationFromMapCenter(mapCenter, shouldRefreshSlider = false) {
  if (!Array.isArray(mapCenter) || mapCenter.length < 2) return;

  const coordsToGeoJSON = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: mapCenter,
    }
  };

  const options = {
    from: 'EPSG:25832',
    to: 'EPSG:4326'
  };

  widget.transform(coordsToGeoJSON, options, (geojson) => {
    config.latlongCoords = geojson.geometry.coordinates;

    if (shouldRefreshSlider) {
      updateSlider(dateControl.value, config.latlongCoords);
      const percent = localTimeToSliderPercent(getCurrentPreviewTime() || config.defaultTime, dateControl.value, config.latlongCoords);
      $("#slider").roundSlider("option", "value", percent);
      roundSliderUpdate({ value: percent });
    }

    updateEclipseEstimateForCurrentLocation();
  });
}


function setMapScale() {
  const mapContainer = document.querySelector('.map-container');
  if (!mapContainer) return false;

  const isStackedLayout = window.matchMedia('(max-width: 1449px)').matches;
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
  const containerWidth = mapContainer.clientWidth || mapContainer.getBoundingClientRect().width || 0;
  const usableWidth = Math.max(containerWidth, Math.min(viewportWidth, config.wrapperSize));
  const widthScale = usableWidth / config.wrapperSize;

  if (!Number.isFinite(widthScale) || widthScale <= 0) {
    return false;
  }

  let targetScale = widthScale;

  if (!isStackedLayout) {
    const clock = document.querySelector('.clock');
    const gap = parseFloat(getComputedStyle(mapContainer).gap) || 0;
    const topOverflow = getCssPxVar('--map-top-overflow', 20);
    const availableHeight = mapContainer.clientHeight - (clock?.offsetHeight || 0) - gap;
    const heightScale = availableHeight / (config.wrapperSize + topOverflow);
    if (Number.isFinite(heightScale) && heightScale > 0) {
      targetScale = Math.min(widthScale, heightScale);
    }
  }

  const clampedScale = Math.min(1, Math.max(0.28, targetScale));
  document.documentElement.style.setProperty('--map-scale', clampedScale.toFixed(4));
  return true;
}

let mapScaleRetryTimer = null;

function scheduleMapScale() {
  if (mapScaleRetryTimer) {
    window.clearTimeout(mapScaleRetryTimer);
    mapScaleRetryTimer = null;
  }

  window.requestAnimationFrame(() => {
    const applied = setMapScale();

    // Retry shortly when Chrome reports transient 0-size boxes during initial layout/orientation changes.
    if (!applied) {
      mapScaleRetryTimer = window.setTimeout(() => {
        mapScaleRetryTimer = null;
        scheduleMapScale();
      }, 120);
    }
  });
}

scheduleMapScale();
window.addEventListener('resize', scheduleMapScale);
window.addEventListener('orientationchange', scheduleMapScale);
window.addEventListener('load', scheduleMapScale);

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleMapScale);
}

const dateControl = { value: config.defaultDate };

let sunAndNightDegreesArray = calculateSunAndNightDegrees(config.defaultDate, config.latlongCoords)

let nightDegrees = sunAndNightDegreesArray[0][0]
let sunDegrees = sunAndNightDegreesArray[0][1]

let nightTotal = sunAndNightDegreesArray[1][0]
let sunTotal = sunAndNightDegreesArray[1][1]

// Data til sol- og skyggefelter i gradsandele af 360
var data = [
  {
   "name": "Nat", 
   "color": "#346789", 
   "degrees": nightDegrees,
   "total" : nightTotal
  }, {
   "name": "Sol", 
   "color": "#F3C546", 
   "degrees": sunDegrees,
   "total": sunTotal
  },
];

// Setup global variables
var svg = document.getElementById('pie-chart'),
    list = document.getElementById('pie-values'),
    natValue = data[0].degrees,
    dayValue = data[1].degrees,
    sliderEnd =  natValue + config.sliderOffset,
    sliderStart = dayValue + config.sliderOffset

	console.log( sliderStart, sliderEnd );

createPieChart(data, config.radius, config.circleLength)
datePickerUpdate(config.defaultDate)

function createPieChart(data, radius, circleLength){
  const totalValue = data.reduce((sum, item) => sum + item.total, 0);
  let spaceLeft = circleLength;

  // Rebuild the ring from scratch to avoid accumulated segments on date changes.
  svg.innerHTML = '';
  list.innerHTML = '';

  // Loop trough data to create pie
  for (var c = 0; c < data.length; c++) {

    // Create circle
    var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    
    // Set attributes
    circle.setAttribute("class", "pie-chart-value");
    circle.setAttribute("cx", config.pieCenter);
    circle.setAttribute("cy", config.pieCenter);
    circle.setAttribute("r", radius);
    
    // Set dash on circle
    circle.style.strokeDasharray = (spaceLeft) + " " + circleLength;
    
    // Set Stroke color
    circle.style.stroke = data[c].color;
    
    // Append circle to svg
    svg.appendChild(circle);

    // Subtract current value from spaceLeft
    spaceLeft -= (data[c].total / totalValue) * circleLength;
    
    // Add value to list
    var listItem = document.createElement('li'),
        valuePct = parseFloat((data[c].total / totalValue) * 100).toFixed(1);
    // Add text to list item
    listItem.innerHTML = data[c].name + ' (' + valuePct + '%)';
    
    // Set color of value to create relation to pie
    listItem.style.color = data[c].color;
    
    // Append to list
    list.appendChild(listItem);
  }

}

function roundSliderUpdate(e) {

  const time = sliderValueToTime(e.value, dateControl, config.latlongCoords)
  console.log(e.value, dateControl.value, time);

  widget.updateLayerParams('skygge-kort', {
    TIME: time // The widget automatically converts UTC to local time
  })
}


function sliderValueToTime(percent, dateControl, latlongCoords) {
  let date = new Date(dateControl.value);
  let times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);

  console.log(date)

  // Ensure sunrise and sunset are valid Date objects
  if (!times.sunrise || !times.sunset) {
      console.error('Error: Sunrise or sunset times are not valid.');
      return null;
  }

  // Calculate total daylight time in seconds.
  let sunriseSeconds = (times.sunrise.getUTCHours() * 3600)
    + (times.sunrise.getUTCMinutes() * 60)
    + times.sunrise.getUTCSeconds(); // UTC accounts for winter/summer time.
  let sunsetSeconds = (times.sunset.getUTCHours() * 3600)
    + (times.sunset.getUTCMinutes() * 60)
    + times.sunset.getUTCSeconds();

  console.log(sunsetSeconds)
  let daylightDuration = sunsetSeconds - sunriseSeconds;

  // Calculate the seconds corresponding to the percentage of daylight.
  let secondsFromSunrise = (percent / 100) * daylightDuration;
  let totalSeconds = sunriseSeconds + secondsFromSunrise;

  // Convert total seconds into hours, minutes and seconds.
  let hours = Math.floor(totalSeconds / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  let seconds = Math.floor(totalSeconds % 60);
  console.log(minutes)

  // Format into HH:MM:SS.
  let time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  console.log(time)

  let formattedMonth = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  let formattedDate = date.getUTCDate().toString().padStart(2, '0');

  // Format the final string
  let formattedString = `${date.getUTCFullYear()}-${formattedMonth}-${formattedDate}T${time}+00:00/${date.getUTCFullYear()}-${formattedMonth}-${formattedDate}T00:00:00+00:00`; // Format into UTC TIME
  console.log('Formatted string:', formattedString);

  // Create a new Date object for local time
  let localTime = new Date(date);
  localTime.setUTCHours(hours, minutes, seconds, 0);

  // Convert local time to local timezone string
  let localTimeString = formatLocalClock(localTime, false) || config.defaultTime;
  updateSliderTime(localTimeString)

  return formattedString;
}

function datePickerUpdate(newDate){
  updateSlider(newDate, config.latlongCoords);
  const startPercent = localTimeToSliderPercent(config.defaultTime, newDate, config.latlongCoords);
  roundSliderUpdate({ value: startPercent });
}

function calculateSolarNoonTimeInMinutes(dateControl, latlongCoords){
  let date = new Date(dateControl);
  let times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);

  let solarNoon = new Date(times.solarNoon) // Get time at solar noon (when the sun is highest in the sky)
  let solarNoonInMinutes = solarNoon.getHours() * 60 + solarNoon.getMinutes()
  
  return solarNoonInMinutes
}

function rotateToMatchSolarNoon(solarNoonInMinutes) { // solarNoonPosition is always in degrees
  let minutesInADay = 1440;
  console.log('solarNoonInMinutes: ', solarNoonInMinutes)

  let solarNoonInFractionOfADay = solarNoonInMinutes / minutesInADay
  let solarNoonDegrees = solarNoonInFractionOfADay * 360

  console.log('solarNoonDegrees: ', solarNoonDegrees)

  let rotation = 180 - solarNoonDegrees
  console.log('rotation: ', rotation)

  $('#rotate-time').css({'transform' : 'rotate('+ rotation +'deg)'}) // Possible that we need -rotation
  
}

function calculateSunAndNightDegrees(dateControl, latlongCoords){
  const minutesInADay = 1440;
  const date = new Date(dateControl);
  const times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);

  const solarNoonInMinutes = calculateSolarNoonTimeInMinutes(dateControl, latlongCoords);
  rotateToMatchSolarNoon(solarNoonInMinutes); // This rotates the SVG to match solar noon at 6 o'clock.

  const sunrise = new Date(times.sunrise);
  const sunset = new Date(times.sunset);

  const sunriseInMinutes = sunrise.getHours() * 60 + sunrise.getMinutes();
  const sunsetInMinutes = sunset.getHours() * 60 + sunset.getMinutes();

  const daylightMinutes = sunsetInMinutes - sunriseInMinutes; // Total daylight duration

  // Calculate the solar noon offset in degrees (solar noon should always be at 180 degrees or 6 o'clock)
  const solarNoonDegrees = 180;

  // Calculate how far sunrise and sunset are from solar noon in degrees
  const halfDaylightDegrees = (daylightMinutes / minutesInADay) * 360 / 2;

  const sunStartDegrees = solarNoonDegrees - halfDaylightDegrees + 45;
  const sunEndDegrees = solarNoonDegrees + halfDaylightDegrees + 45;

  // Calculate sun and night degrees
  const sunDegrees = sunEndDegrees - sunStartDegrees;
  const nightDegrees = 360 - sunDegrees;

  data = [
    {
      "name": "Nat",
      "color": "#346789",
      "degrees": sunEndDegrees,   // Updated dynamically
      "total" : nightDegrees
    },
    {
      "name": "Sol",
      "color": "#F3C546",
      "degrees": sunStartDegrees,   // Updated dynamically
      "total" : sunDegrees
    }
  ];

  console.log(data);
  updateSunFraction(sunDegrees);
  updateSunTime(sunsetInMinutes - sunriseInMinutes);

  return [[sunEndDegrees, sunStartDegrees], [nightDegrees, sunDegrees]];
}


function updateSlider(dateControl, latlongCoords) {
  let sunAndNightDegreesArray = calculateSunAndNightDegrees(dateControl, latlongCoords);
  let sunStartDegrees = sunAndNightDegreesArray[0][1];
  let sunEndDegrees = sunAndNightDegreesArray[0][0];

  // Update roundSlider with the new values
  $("#slider").roundSlider("option", "startAngle", sunStartDegrees + config.sliderOffset);
  $("#slider").roundSlider("option", "endAngle", sunEndDegrees + config.sliderOffset);
  $("#slider").roundSlider("option", "value", localTimeToSliderPercent(config.defaultTime, dateControl, latlongCoords));

  createPieChart(data, config.radius, config.circleLength);

  // Re-render the pie chart with updated rotation
  $("#pie-chart").css({'transform' : 'rotate('+ (sunStartDegrees + config.sliderOffset  + config.rotationAdjustment) +'deg)'});
}



function updateSunFraction(sunDegrees){
  let sunFraction = (sunDegrees / 360) * 100 // Can be rouded if we think its cleaner looking
  document.getElementById('sun-fraction').innerText = `${sunFraction.toFixed(1)}%`
}

function updateSunTime(sunMinutes){
  let hours = Math.floor(sunMinutes / 60)
  let minutes = sunMinutes % 60
  document.getElementById('sun-time').innerText = `${hours} t. ${minutes} min.`
}

function updateSliderTime(time){
  const displayTime = normalizeClockString(time, false) || config.defaultTime;
  document.getElementById('slider-time').value = displayTime;

  if (config.eclipse) {
    updateEclipsePreview(config.eclipse, displayTime);
  }
}

function syncTimeInputToSliderAndClock(localTimeValue, dateValue, latlongCoords) {
  const percent = localTimeToSliderPercent(localTimeValue, dateValue, latlongCoords);

  // Keep the round slider handle and ring in sync with the typed time.
  $("#slider").roundSlider("option", "value", percent);
  updateSliderTime(localTimeValue);
  roundSliderUpdate({ value: percent });
}

function localTimeToSliderPercent(localTimeStr, dateStr, latlongCoords) {
  const date = new Date(dateStr);
  const times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);
  const sunriseUTC = (times.sunrise.getUTCHours() * 3600) + (times.sunrise.getUTCMinutes() * 60) + times.sunrise.getUTCSeconds();
  const sunsetUTC = (times.sunset.getUTCHours() * 3600) + (times.sunset.getUTCMinutes() * 60) + times.sunset.getUTCSeconds();
  const parsed = parseLocalClockToParts(localTimeStr);
  if (!parsed) return 0;
  const { hours, minutes, seconds } = parsed;
  const localDate = new Date(dateStr);
  localDate.setHours(hours, minutes, seconds, 0);
  const targetUTC = (localDate.getUTCHours() * 3600) + (localDate.getUTCMinutes() * 60) + localDate.getUTCSeconds();
  return Math.max(0, Math.min(100, (targetUTC - sunriseUTC) / (sunsetUTC - sunriseUTC) * 100));
}

function updateSliderTimeFromValue(percent, dateControl, latlongCoords) {
  
  let date = new Date(dateControl.value);
  let times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);

  // Calculate total daylight time in seconds.
  let sunriseSeconds = (times.sunrise.getUTCHours() * 3600)
    + (times.sunrise.getUTCMinutes() * 60)
    + times.sunrise.getUTCSeconds(); // UTC accounts for winter/summer time.
  let sunsetSeconds = (times.sunset.getUTCHours() * 3600)
    + (times.sunset.getUTCMinutes() * 60)
    + times.sunset.getUTCSeconds();

  let daylightDuration = sunsetSeconds - sunriseSeconds;

  // Calculate the seconds corresponding to the percentage of daylight.
  let secondsFromSunrise = (percent / 100) * daylightDuration;
  let totalSeconds = sunriseSeconds + secondsFromSunrise;

  // Convert total seconds into hours, minutes and seconds.
  let hours = Math.floor(totalSeconds / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  let seconds = Math.floor(totalSeconds % 60);

  // Create a new Date object for local time
  let localTime = new Date(date);
  localTime.setUTCHours(hours, minutes, seconds, 0);

  // Convert local time to local timezone string
  let localTimeString = formatLocalClock(localTime, false) || config.defaultTime;
  
  console.log('new local time', localTimeString)
  updateSliderTime(localTimeString)
}

function moveSupportBranding() {
  const logo = document.querySelector('.logo');
  const copyright = document.querySelector('.widget-map-copyright');
  const desktopLogoSlot = document.querySelector('.desktop-corner__logo-slot');
  const desktopCopyrightSlot = document.querySelector('.desktop-corner__copyright');
  const mobileLogoSlot = document.querySelector('.mobile-sticky-header__logo-slot');
  const mobileCopyrightSlot = document.querySelector('.mobile-copyright');
  const isMobileLayout = window.matchMedia('(max-width: 1449px)').matches;

  if (logo) {
    const targetLogoSlot = isMobileLayout ? mobileLogoSlot : desktopLogoSlot;
    if (targetLogoSlot && logo.parentElement !== targetLogoSlot) {
      targetLogoSlot.appendChild(logo);
    }
  }

  if (copyright) {
    const targetCopyrightSlot = isMobileLayout ? mobileCopyrightSlot : desktopCopyrightSlot;
    if (targetCopyrightSlot && copyright.parentElement !== targetCopyrightSlot) {
      targetCopyrightSlot.appendChild(copyright);
    }
  }
}



jQuery(document).ready(($) => {
  moveSupportBranding();
  scheduleMapScale();
  window.addEventListener('resize', moveSupportBranding);
  bindEclipseTimeButtons();
  bindTimeInput();

  widget.on('ready', () => {
    moveSupportBranding();
    scheduleMapScale();
    syncLocationFromMapCenter(config.mapCenter, true);
  })

// Range slider init
	$("#slider").roundSlider({
    radius: config.sliderRadius,
		width: 20,
    step: config.sliderStep,
    value: localTimeToSliderPercent(config.defaultTime, config.defaultDate, config.latlongCoords),
    startAngle: sliderStart,
    endAngle: sliderEnd, 
    showTooltip: false,
    handleSize: "+40",
    handleShape: "dot",
    change: roundSliderUpdate,
    drag: function (e) {
      // e.value will be the current value of the slider during dragging
      updateSliderTimeFromValue(e.value, dateControl, config.latlongCoords); // horribly inefficient since there's so much calculation it doesn't need to do
    }
	});

  // getBoundingClientRect gives rendered (zoomed) dimensions; outerWidth/Height does not — fix the mismatch.
  const rsInstance = $("#slider").data("roundSlider");
  if (rsInstance) {
    rsInstance._getCenterPoint = function () {
      const rect = this.block[0].getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + rect.width / 2,
        y: rect.top + window.scrollY + rect.height / 2,
      };
    };
  }

  // Rotate color fields according to natValue
  $("#pie-chart").css({'transform' : 'rotate('+ (sunDegrees + config.sliderOffset + config.rotationAdjustment) +'deg)'}); // + 180 to flip it to correct side, + 45 due to the offset

  // Override widget's default/cached center with our desired starting position
  widget.setView({
    zoomLevel: config.mapZoom,
    x: config.mapCenter[0],
    y: config.mapCenter[1],
  })

  widget.on('mapmove', (eventname, scope, mapstate) => {
    syncLocationFromMapCenter(mapstate.center);
  });
  

});	// end document.ready-function	// end document.ready-function

// document.getElementById("fullscreen").addEventListener("click", function() {
//   if (!document.fullscreenElement) {
//     document.documentElement.requestFullscreen().catch(err => {
//       console.log(`Fejl ved forsøg på at gå i fullscreen: ${err.message}`);
//     });
//   } else {
//     if (document.exitFullscreen) {
//       document.exitFullscreen();
//     }
//   }
// });
