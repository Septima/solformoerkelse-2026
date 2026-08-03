const { default: SunCalc } = await import('https://cdn.skypack.dev/suncalc@1.8.0');
const { default: WidgetAPI } = await import('https://widget.cdn.septima.dk/latest/widgetapi.mjs')
const mapConfigUrl = new URL('./config/map.json', document.baseURI).href;
const widget = new WidgetAPI('.widgetmap', mapConfigUrl)


const config = {
  radius: 410,
  latlongCoords: [12.539792090268461, 55.70698126629835], // Rådhuspladsen coordinates for initial view. Beware that im not sure the coordinates are in the correct order
  sliderOffset: 45, // The slider is turned by 45 degress so we add this to account for the offset
  rotationAdjustment: 180, // Not entirely sure why, but the rotation is usually flipped, so we need to turn it 180 deg. to re-flip it
  circleLength: Math.PI * (410 * 2), // Circumference
  defaultDate: '2026-08-12',
  defaultTime: '20:00', // Lokal dansk tid for solformørkelsens toppunkt
  mapCenter: [724282.08, 6178621.15], // EPSG:25832
  mapZoom: 11,
};


function setMapScale() {
  const available = window.innerWidth - 48; // 48px accounts for 1.5rem padding on each side
  // On mobile the slider is hidden, so scale against the 780px map diameter instead of the 960px wrapper
  const reference = window.innerWidth < 1450 ? 780 : 960;
  document.documentElement.style.setProperty('--map-scale', Math.min(1, available / reference));
}
setMapScale();
window.addEventListener('resize', setMapScale);

var dateControl = document.querySelector('input[type="date"]');
dateControl.value = config.defaultDate;

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
    totalValue = 0,
    radius = config.radius,
    circleLength = config.circleLength, // Circumference
    spaceLeft = config.circleLength,

    natValue = data[0].degrees,
    dayValue = data[1].degrees,
    sliderEnd =  natValue + config.sliderOffset,
    sliderStart = dayValue + config.sliderOffset

	console.log( sliderStart, sliderEnd );

// Get total value of all data
for (var i = 0; i < data.length; i++) {
  totalValue += data[i].total;
}

createPieChart(data, config.radius, config.circleLength, spaceLeft)
datePickerUpdate(config.defaultDate)

function createPieChart(data, radius, circleLength, spaceLeft){
  // Loop trough data to create pie
  for (var c = 0; c < data.length; c++) {

    // Create circle
    var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    
    // Set attributes
    circle.setAttribute("class", "pie-chart-value");
    circle.setAttribute("cx", 430);
    circle.setAttribute("cy", 430);
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

  // Calculate total daylight time in minutes
  let sunriseMinutes = times.sunrise.getUTCHours() * 60 + times.sunrise.getUTCMinutes(); // Format to utc to accounts for winter/summer time. 
  let sunsetMinutes = times.sunset.getUTCHours() * 60 + times.sunset.getUTCMinutes();

  console.log(sunsetMinutes)
  let daylightDuration = sunsetMinutes - sunriseMinutes;

  // Calculate the minutes corresponding to the percentage of daylight
  let minutesFromSunrise = (percent / 100) * daylightDuration;
  let totalMinutes = sunriseMinutes + minutesFromSunrise;

  // Convert total minutes into hours and minutes
  let hours = Math.floor(totalMinutes / 60);
  let minutes = Math.floor(totalMinutes % 60);
  console.log(minutes)

  // Format hours and minutes into HH:MM format
  let time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  console.log(time)

  let formattedMonth = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  let formattedDate = date.getUTCDate().toString().padStart(2, '0');

  // Format the final string
  let formattedString = `${date.getUTCFullYear()}-${formattedMonth}-${formattedDate}T${time}:00+00:00/${date.getUTCFullYear()}-${formattedMonth}-${formattedDate}T00:00:00+00:00`; // Format into UTC TIME
  console.log('Formatted string:', formattedString);

  // Create a new Date object for local time
  let localTime = new Date(date);
  localTime.setUTCHours(hours, minutes, 0);

  // Sync time input to local time (not UTC) so input matches the clock display
  const timeInput = document.querySelector('input.time');
  if (timeInput) timeInput.value = `${localTime.getHours().toString().padStart(2, '0')}:${localTime.getMinutes().toString().padStart(2, '0')}`;

  // Convert local time to local timezone string
  let localTimeString = localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  createPieChart(data, config.radius, config.circleLength, spaceLeft);

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
  document.getElementById('slider-time').innerText = `${time}`
}

function localTimeToSliderPercent(localTimeStr, dateStr, latlongCoords) {
  const date = new Date(dateStr);
  const times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);
  const sunriseUTC = times.sunrise.getUTCHours() * 60 + times.sunrise.getUTCMinutes();
  const sunsetUTC = times.sunset.getUTCHours() * 60 + times.sunset.getUTCMinutes();
  const [h, m] = localTimeStr.split(':').map(Number);
  const localDate = new Date(dateStr);
  localDate.setHours(h, m, 0, 0);
  const targetUTC = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  return Math.max(0, Math.min(100, (targetUTC - sunriseUTC) / (sunsetUTC - sunriseUTC) * 100));
}

function updateSliderTimeFromValue(percent, dateControl, latlongCoords) {
  
  let date = new Date(dateControl.value);
  let times = SunCalc.getTimes(date, latlongCoords[1], latlongCoords[0]);

  // Calculate total daylight time in minutes
  let sunriseMinutes = times.sunrise.getUTCHours() * 60 + times.sunrise.getUTCMinutes(); // Format to utc to accounts for winter/summer time. 
  let sunsetMinutes = times.sunset.getUTCHours() * 60 + times.sunset.getUTCMinutes();

  let daylightDuration = sunsetMinutes - sunriseMinutes;

  // Calculate the minutes corresponding to the percentage of daylight
  let minutesFromSunrise = (percent / 100) * daylightDuration;
  let totalMinutes = sunriseMinutes + minutesFromSunrise;

  // Convert total minutes into hours and minutes
  let hours = Math.floor(totalMinutes / 60);
  let minutes = Math.floor(totalMinutes % 60);

  // Create a new Date object for local time
  let localTime = new Date(date);
  localTime.setUTCHours(hours, minutes, 0);

  // Convert local time to local timezone string
  let localTimeString = localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  updateSliderTime(localTimeString)
}



jQuery(document).ready(($) => {

// Range slider init
	$("#slider").roundSlider({
		radius: 420,
		width: 20,
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

  // Rotate color fields according to natValue
  $("#pie-chart").css({'transform' : 'rotate('+ (sunDegrees + config.sliderOffset + config.rotationAdjustment) +'deg)'}); // + 180 to flip it to correct side, + 45 due to the offset

  dateControl.addEventListener('change', function() {
    const timeControl = document.querySelector('input.time');
    if (timeControl) timeControl.value = config.defaultTime;
    datePickerUpdate(this.value);
  });

  const timeControl = document.querySelector('input.time');
  if (timeControl) {
    timeControl.addEventListener('change', function() {
      const percent = localTimeToSliderPercent(this.value, dateControl.value, config.latlongCoords);
      roundSliderUpdate({ value: percent });
    });
  }

  // Override widget's default/cached center with our desired starting position
  widget.getMap().getView().setCenter(config.mapCenter);
  widget.getMap().getView().setZoom(config.mapZoom);

  widget.on('mapmove', (eventname, scope, mapstate) => {
    console.log('Mapstate:', mapstate);

    let coordsToGeoJSON = {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": mapstate.center
      }
    };

    let options = {
      from: 'EPSG:25832',
      to: 'EPSG:4326'
    };

    widget.transform(coordsToGeoJSON, options, (geojson) => {
      console.log(geojson.geometry.coordinates);
      config.latlongCoords = geojson.geometry.coordinates;
    });

  });
  

});	// end document.ready-function	// end document.ready-function

document.getElementById("fullscreen").addEventListener("click", function() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log(`Fejl ved forsøg på at gå i fullscreen: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
});
