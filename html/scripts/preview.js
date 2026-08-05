const Astronomy = await import('https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm');

const PREVIEW_SIZE = 200;
const PREVIEW_FOV_DEGREES = 12;
const APPARENT_DISC_SCALE = 6.5;
const HORIZON_RISE_IN_SUN_RADII = 0; // change to move horizon up/down
const SUN_RADIUS_KM = 695700;
const MOON_RADIUS_KM = 1737.4;
const DEFAULT_TIME_ZONE = 'Europe/Copenhagen';

const timeZoneFormatters = new Map();

function getTimeZoneFormatter(timeZone) {
  if (!timeZoneFormatters.has(timeZone)) {
    timeZoneFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }

  return timeZoneFormatters.get(timeZone);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseDateParts(dateString) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
  };
}

function parseClockParts(timeString) {
  const match = String(timeString || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3] || '0', 10);

  if (
    hours < 0 || hours > 23
    || minutes < 0 || minutes > 59
    || seconds < 0 || seconds > 59
  ) {
    return null;
  }

  return { hours, minutes, seconds };
}

function getTimeZoneParts(date, timeZone) {
  const parts = getTimeZoneFormatter(timeZone).formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(lookup.year, 10),
    month: Number.parseInt(lookup.month, 10),
    day: Number.parseInt(lookup.day, 10),
    hours: Number.parseInt(lookup.hour, 10),
    minutes: Number.parseInt(lookup.minute, 10),
    seconds: Number.parseInt(lookup.second, 10),
  };
}

function zonedTimeToDate(dateString, timeString, timeZone = DEFAULT_TIME_ZONE) {
  const dateParts = parseDateParts(dateString);
  const clockParts = parseClockParts(timeString);

  if (!dateParts || !clockParts) return null;

  const targetUtcParts = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    clockParts.hours,
    clockParts.minutes,
    clockParts.seconds,
    0,
  );

  let utcMillis = targetUtcParts;

  for (let i = 0; i < 4; i += 1) {
    const observed = getTimeZoneParts(new Date(utcMillis), timeZone);
    const observedUtcParts = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hours,
      observed.minutes,
      observed.seconds,
      0,
    );

    const delta = observedUtcParts - targetUtcParts;
    if (Math.abs(delta) < 1000) break;
    utcMillis -= delta;
  }

  return new Date(utcMillis);
}

function degToRad(degrees) {
  return degrees * Astronomy.DEG2RAD;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function horizontalToVector(azimuth, altitude) {
  const azimuthRad = degToRad(azimuth);
  const altitudeRad = degToRad(altitude);
  const cosAltitude = Math.cos(altitudeRad);

  return {
    x: cosAltitude * Math.sin(azimuthRad),
    y: cosAltitude * Math.cos(azimuthRad),
    z: Math.sin(altitudeRad),
  };
}

function averageAngles(angleA, angleB) {
  const ax = Math.cos(degToRad(angleA));
  const ay = Math.sin(degToRad(angleA));
  const bx = Math.cos(degToRad(angleB));
  const by = Math.sin(degToRad(angleB));
  return (Math.atan2(ay + by, ax + bx) * Astronomy.RAD2DEG + 360) % 360;
}

function angularRadiusDegrees(radiusKm, distanceAu) {
  return Math.atan2(radiusKm, distanceAu * Astronomy.KM_PER_AU) * Astronomy.RAD2DEG;
}

function calculateBodyPosition(body, time, observer, radiusKm) {
  const equator = Astronomy.Equator(body, time, observer, true, true);
  const horizon = Astronomy.Horizon(time, observer, equator.ra, equator.dec, 'normal');
  const direction = normalizeVector(equator.vec);

  return {
    azimuth: horizon.azimuth,
    altitude: horizon.altitude,
    distanceAu: equator.dist,
    angularRadiusDeg: angularRadiusDegrees(radiusKm, equator.dist),
    direction,
  };
}

function angularSeparationDegrees(bodyA, bodyB) {
  const separation = clamp(dot(bodyA.direction, bodyB.direction), -1, 1);
  return Math.acos(separation) * Astronomy.RAD2DEG;
}

function getExactCoverage(bodyA, bodyB) {
  const overlap = circleOverlapArea(
    bodyA.angularRadiusDeg,
    bodyB.angularRadiusDeg,
    angularSeparationDegrees(bodyA, bodyB),
  );

  return clamp(overlap / (Math.PI * bodyA.angularRadiusDeg * bodyA.angularRadiusDeg), 0, 1);
}

function createCamera(sun, moon) {
  const centerAzimuth = sun.azimuth;
  const centerAltitude = clamp(sun.altitude, -89.5, 89.5);
  const forward = normalizeVector(horizontalToVector(centerAzimuth, centerAltitude));
  const worldUp = { x: 0, y: 0, z: 1 };

  let right = cross(forward, worldUp);
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
    right = { x: 1, y: 0, z: 0 };
  }

  right = normalizeVector(right);
  const up = normalizeVector(cross(right, forward));
  const focalLength = (PREVIEW_SIZE / 2) / Math.tan(degToRad(PREVIEW_FOV_DEGREES / 2));

  return {
    centerAzimuth,
    centerAltitude,
    forward,
    right,
    up,
    focalLength,
  };
}

function projectVector(worldVector, camera) {
  const depth = dot(worldVector, camera.forward);
  if (depth <= 0) return null;

  return {
    x: (PREVIEW_SIZE / 2) + ((dot(worldVector, camera.right) / depth) * camera.focalLength),
    y: (PREVIEW_SIZE / 2) - ((dot(worldVector, camera.up) / depth) * camera.focalLength),
  };
}

function projectBody(body, camera) {
  const projected = projectVector(horizontalToVector(body.azimuth, body.altitude), camera);
  if (!projected) return null;

  return {
    ...projected,
    radiusPx: camera.focalLength * Math.tan(degToRad(body.angularRadiusDeg)),
  };
}

function scaleBodyPair(sunScreen, moonScreen, scale) {
  if (!Number.isFinite(scale) || scale === 1) {
    return { sunScreen, moonScreen };
  }

  return {
    sunScreen: {
      ...sunScreen,
      radiusPx: sunScreen.radiusPx * scale,
    },
    moonScreen: {
      ...moonScreen,
      x: sunScreen.x + ((moonScreen.x - sunScreen.x) * scale),
      y: sunScreen.y + ((moonScreen.y - sunScreen.y) * scale),
      radiusPx: moonScreen.radiusPx * scale,
    },
  };
}

function circleOverlapArea(radius1, radius2, separation) {
  if (separation >= radius1 + radius2) return 0;

  if (separation <= Math.abs(radius1 - radius2)) {
    const minRadius = Math.min(radius1, radius2);
    return Math.PI * minRadius * minRadius;
  }

  const r1sq = radius1 * radius1;
  const r2sq = radius2 * radius2;
  const alpha = Math.acos((separation * separation + r1sq - r2sq) / (2 * separation * radius1));
  const beta = Math.acos((separation * separation + r2sq - r1sq) / (2 * separation * radius2));
  const part3 = 0.5 * Math.sqrt(
    (-separation + radius1 + radius2)
    * (separation + radius1 - radius2)
    * (separation - radius1 + radius2)
    * (separation + radius1 + radius2)
  );

  return (r1sq * alpha) + (r2sq * beta) - part3;
}

function getCoverage(sunScreen, moonScreen) {
  const dx = moonScreen.x - sunScreen.x;
  const dy = moonScreen.y - sunScreen.y;
  const separation = Math.hypot(dx, dy);
  const overlap = circleOverlapArea(sunScreen.radiusPx, moonScreen.radiusPx, separation);
  return clamp(overlap / (Math.PI * sunScreen.radiusPx * sunScreen.radiusPx), 0, 1);
}

function drawBackground(ctx, sunPosition, sunScreen, coverage) {
  ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

  const baseSky = ctx.createLinearGradient(0, 0, 0, PREVIEW_SIZE);
  const twilightLift = clamp((18 - sunPosition.altitude) / 18, 0, 1);
  baseSky.addColorStop(0, `rgba(${Math.round(25 + twilightLift * 34)}, ${Math.round(53 + twilightLift * 28)}, ${Math.round(88 + twilightLift * 20)}, 1)`);
  baseSky.addColorStop(0.58, `rgba(${Math.round(64 + twilightLift * 58)}, ${Math.round(109 + twilightLift * 55)}, ${Math.round(162 + twilightLift * 25)}, 1)`);
  baseSky.addColorStop(1, `rgba(${Math.round(252 - twilightLift * 12)}, ${Math.round(188 + twilightLift * 18)}, ${Math.round(108 + twilightLift * 32)}, 1)`);

  ctx.fillStyle = baseSky;
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

  const vignette = ctx.createRadialGradient(PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_SIZE * 0.15, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_SIZE * 0.72);
  vignette.addColorStop(0, 'rgba(255, 255, 255, 0)');
  vignette.addColorStop(1, 'rgba(2, 7, 14, 0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

  const halo = ctx.createRadialGradient(sunScreen.x, sunScreen.y, sunScreen.radiusPx * 0.85, sunScreen.x, sunScreen.y, sunScreen.radiusPx * (4.2 + coverage));
  halo.addColorStop(0, `rgba(255, 245, 197, ${0.38 + (coverage * 0.08)})`);
  halo.addColorStop(0.34, `rgba(255, 213, 103, ${0.26 + (coverage * 0.06)})`);
  halo.addColorStop(1, 'rgba(255, 193, 77, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
}

function drawHorizon(ctx, camera, sunScreen) {
  const horizonRisePx = (sunScreen?.radiusPx || 0) * HORIZON_RISE_IN_SUN_RADII;
  const points = [];
  for (let i = 0; i <= 64; i += 1) {
    const azimuth = camera.centerAzimuth - (PREVIEW_FOV_DEGREES * 0.72) + ((i / 64) * PREVIEW_FOV_DEGREES * 1.44);
    const point = projectVector(horizontalToVector(azimuth, 0), camera);
    if (point) points.push(point);
  }

  if (points.length < 2) return;

  points.sort((a, b) => a.x - b.x);
  const clippedPoints = points.map((point) => ({
    x: clamp(point.x, -PREVIEW_SIZE * 0.2, PREVIEW_SIZE * 1.2),
    y: clamp(point.y - horizonRisePx, 0, PREVIEW_SIZE),
  }));

  const firstPoint = clippedPoints[0];
  const lastPoint = clippedPoints[clippedPoints.length - 1];

  ctx.beginPath();
  ctx.moveTo(firstPoint.x, PREVIEW_SIZE);
  ctx.lineTo(firstPoint.x, firstPoint.y);
  for (let i = 1; i < clippedPoints.length; i += 1) {
    ctx.lineTo(clippedPoints[i].x, clippedPoints[i].y);
  }
  ctx.lineTo(lastPoint.x, PREVIEW_SIZE);
  ctx.closePath();

  const ground = ctx.createLinearGradient(0, firstPoint.y, 0, PREVIEW_SIZE);
  ground.addColorStop(0, 'rgba(28, 47, 33, 0.5)');
  ground.addColorStop(1, 'rgba(10, 16, 14, 0.97)');
  ctx.fillStyle = ground;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (let i = 1; i < clippedPoints.length; i += 1) {
    ctx.lineTo(clippedPoints[i].x, clippedPoints[i].y);
  }
  ctx.strokeStyle = 'rgba(255, 217, 161, 0.82)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawCorona(ctx, sun, coverage) {
  if (coverage < 0.72) return;

  const intensity = clamp((coverage - 0.72) / 0.28, 0, 1);
  ctx.save();
  ctx.translate(sun.x, sun.y);

  for (let i = 0; i < 28; i += 1) {
    const angle = (Math.PI * 2 * i) / 28;
    const wobble = 0.82 + (Math.sin(i * 2.37) * 0.12) + (Math.cos(i * 1.13) * 0.08);
    const inner = sun.radiusPx * (1.02 + (i % 3) * 0.02);
    const outer = sun.radiusPx * (1.9 + wobble + intensity * 0.8);

    const gradient = ctx.createLinearGradient(
      Math.cos(angle) * inner,
      Math.sin(angle) * inner,
      Math.cos(angle) * outer,
      Math.sin(angle) * outer,
    );
    gradient.addColorStop(0, `rgba(255, 250, 232, ${0.82 * intensity})`);
    gradient.addColorStop(0.5, `rgba(200, 227, 255, ${0.42 * intensity})`);
    gradient.addColorStop(1, 'rgba(200, 227, 255, 0)');

    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.65 + (intensity * 0.95);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSun(ctx, sun) {
  const gradient = ctx.createRadialGradient(
    sun.x - (sun.radiusPx * 0.28),
    sun.y - (sun.radiusPx * 0.32),
    sun.radiusPx * 0.16,
    sun.x,
    sun.y,
    sun.radiusPx,
  );
  gradient.addColorStop(0, 'rgba(255, 251, 230, 1)');
  gradient.addColorStop(0.42, 'rgba(255, 220, 124, 1)');
  gradient.addColorStop(1, 'rgba(255, 179, 43, 1)');

  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawMoon(ctx, moon) {
  const gradient = ctx.createRadialGradient(
    moon.x - (moon.radiusPx * 0.18),
    moon.y - (moon.radiusPx * 0.24),
    moon.radiusPx * 0.24,
    moon.x,
    moon.y,
    moon.radiusPx,
  );
  gradient.addColorStop(0, 'rgba(63, 82, 95, 1)');
  gradient.addColorStop(0.62, 'rgba(26, 35, 44, 1)');
  gradient.addColorStop(1, 'rgba(5, 8, 13, 1)');

  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(228, 236, 245, 0.2)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawFallback(ctx) {
  ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  const background = ctx.createLinearGradient(0, 0, 0, PREVIEW_SIZE);
  background.addColorStop(0, 'rgba(30, 53, 79, 1)');
  background.addColorStop(1, 'rgba(243, 173, 95, 1)');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

  ctx.beginPath();
  ctx.moveTo(0, PREVIEW_SIZE * 0.66);
  ctx.quadraticCurveTo(PREVIEW_SIZE / 2, PREVIEW_SIZE * 0.58, PREVIEW_SIZE, PREVIEW_SIZE * 0.66);
  ctx.lineTo(PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.lineTo(0, PREVIEW_SIZE);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12, 20, 18, 0.78)';
  ctx.fill();
}

export function renderEclipsePreview(canvas, options) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = PREVIEW_SIZE;
  canvas.height = PREVIEW_SIZE;

  try {
    const lngLat = Array.isArray(options?.lngLat) ? options.lngLat : null;
    const date = options?.date;
    const time = options?.time;
    const timeZone = options?.timeZone || DEFAULT_TIME_ZONE;

    if (!lngLat || lngLat.length < 2 || !date || !time) {
      drawFallback(ctx);
      return null;
    }

    const observationDate = zonedTimeToDate(date, time, timeZone);
    if (!(observationDate instanceof Date) || Number.isNaN(observationDate.getTime())) {
      drawFallback(ctx);
      return null;
    }

    const observer = new Astronomy.Observer(lngLat[1], lngLat[0], 0);
    const sun = calculateBodyPosition(Astronomy.Body.Sun, observationDate, observer, SUN_RADIUS_KM);
    const moon = calculateBodyPosition(Astronomy.Body.Moon, observationDate, observer, MOON_RADIUS_KM);
    const camera = createCamera(sun, moon);

    const sunScreenExact = projectBody(sun, camera);
    const moonScreenExact = projectBody(moon, camera);

    if (!sunScreenExact || !moonScreenExact) {
      drawFallback(ctx);
      return null;
    }

    const exactCoverage = getExactCoverage(sun, moon);
    const {
      sunScreen,
      moonScreen,
    } = scaleBodyPair(sunScreenExact, moonScreenExact, APPARENT_DISC_SCALE);

    const coverage = getCoverage(sunScreen, moonScreen);
    drawBackground(ctx, sun, sunScreen, coverage);
    drawCorona(ctx, sunScreen, coverage);
    drawSun(ctx, sunScreen);
    drawMoon(ctx, moonScreen);
    drawHorizon(ctx, camera, sunScreen);

    return {
      date: observationDate,
      sun,
      moon,
      exactCoverage,
      coverage,
    };
  } catch (error) {
    console.warn('Unable to render astronomy preview.', error);
    drawFallback(ctx);
    return null;
  }
}