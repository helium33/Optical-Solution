/**
 * Plus Codes (Open Location Code), decode only.
 *
 * WHY THIS EXISTS: a shop owner reads a location off Google Maps as a Plus Code
 * — "XWW2+45W, Muse" — not as a pair of decimals. Asking them to convert it by
 * hand, or to send it to a developer and wait for a deploy, is how a shop pin
 * ends up wrong for three months. This lets the admin settings screen take the
 * string exactly as it was copied.
 *
 * SCOPE: decoding, plus the short-code recovery that makes "XWW2+45W" mean
 * anything at all. Encoding is deliberately absent — nothing in the app needs
 * to produce a code, and an unused encoder is an unused liability.
 *
 * The constants are not guesses. This is the published algorithm, and the
 * implementation was checked against Google's own test vectors
 * (test_data/decoding.csv, 420 cases, and the recovery cases in
 * shortCodeTests.csv) before any of it reached a branch record. A geofence
 * decides whether someone gets paid; "a library said so" is not an audit trail.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';
const BASE = 20;
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PAIR_LENGTH = 10;
const MAX_DIGITS = 15;

/* Each grid digit splits the cell 5 ways north-south and 4 ways east-west —
   5 x 4 = 20, one alphabet character. They are NOT interchangeable; swapping
   them produces codes that look plausible and land tens of metres away. */
const GRID_ROWS = 5;
const GRID_COLS = 4;

const PAIR_PRECISION = BASE ** 3; //                           8_000
const FINAL_LAT_PRECISION = PAIR_PRECISION * GRID_ROWS ** 5; // 25_000_000
const FINAL_LNG_PRECISION = PAIR_PRECISION * GRID_COLS ** 5; //  8_192_000
const PAIR_FIRST_PV = BASE ** (PAIR_LENGTH / 2 - 1); //            160_000
const GRID_LAT_FIRST_PV = GRID_ROWS ** 4; //                           625
const GRID_LNG_FIRST_PV = GRID_COLS ** 4; //                           256

/** Strip the separator, the '0' padding and any trailing locality name. */
const digitsOf = (code) =>
  String(code)
    .trim()
    .toUpperCase()
    .split(',')[0]
    .trim()
    .split(/\s+/)[0]
    .replace(/\+/g, '')
    .replace(/0/g, '');

/**
 * A code is "full" when it carries all eight characters before the separator.
 * Anything shorter is a short code and is meaningless without a reference
 * point — `XWW2+45W` names a cell in every 1-degree block on Earth.
 */
export function isFullPlusCode(code) {
  const text = String(code ?? '').trim().toUpperCase().split(',')[0].trim().split(/\s+/)[0];
  const sep = text.indexOf(SEPARATOR);
  return sep === SEPARATOR_POSITION;
}

export function isPlusCodeish(code) {
  const text = String(code ?? '').trim().toUpperCase().split(',')[0].trim().split(/\s+/)[0];
  const sep = text.indexOf(SEPARATOR);
  if (sep < 2 || sep > SEPARATOR_POSITION || sep % 2 !== 0) return false;
  const body = text.replace(/\+/g, '').replace(/0/g, '');
  return body.length >= 2 && [...body].every((ch) => ALPHABET.includes(ch));
}

/**
 * Decode a FULL code to the centre of the cell it names, with the cell's own
 * size alongside — a 6-digit code names a 14 km block, and a UI that renders
 * that as a confident pin is lying.
 *
 * @returns {{lat:number, lng:number, latSpan:number, lngSpan:number}|null}
 */
export function decodePlusCode(code) {
  const c = digitsOf(code);
  /* Below the pair section a code is always an even number of digits; past it
     the grid digits are single. Anything else is a typo, not a location. */
  if (c.length < 2) return null;
  if (c.length < PAIR_LENGTH && c.length % 2 !== 0) return null;
  if (![...c].every((ch) => ALPHABET.includes(ch))) return null;

  let normalLat = -90 * PAIR_PRECISION;
  let normalLng = -180 * PAIR_PRECISION;
  let gridLat = 0;
  let gridLng = 0;

  const pairDigits = Math.min(c.length, PAIR_LENGTH);
  let pv = PAIR_FIRST_PV;
  for (let i = 0; i < pairDigits; i += 2) {
    normalLat += ALPHABET.indexOf(c[i]) * pv;
    normalLng += ALPHABET.indexOf(c[i + 1]) * pv;
    if (i < pairDigits - 2) pv /= BASE;
  }

  let latSpan = pv / PAIR_PRECISION;
  let lngSpan = pv / PAIR_PRECISION;

  if (c.length > PAIR_LENGTH) {
    let rowPv = GRID_LAT_FIRST_PV;
    let colPv = GRID_LNG_FIRST_PV;
    const last = Math.min(c.length, MAX_DIGITS);
    for (let i = PAIR_LENGTH; i < last; i += 1) {
      const digit = ALPHABET.indexOf(c[i]);
      gridLat += Math.floor(digit / GRID_COLS) * rowPv;
      gridLng += (digit % GRID_COLS) * colPv;
      if (i < last - 1) {
        rowPv /= GRID_ROWS;
        colPv /= GRID_COLS;
      }
    }
    latSpan = rowPv / FINAL_LAT_PRECISION;
    lngSpan = colPv / FINAL_LNG_PRECISION;
  }

  const lat = normalLat / PAIR_PRECISION + gridLat / FINAL_LAT_PRECISION;
  const lng = normalLng / PAIR_PRECISION + gridLng / FINAL_LNG_PRECISION;

  return {
    lat: lat + latSpan / 2,
    lng: lng + lngSpan / 2,
    latSpan,
    lngSpan,
  };
}

/**
 * Expand a short code against a nearby reference point, then decode it.
 *
 * The reference only has to be within about half a degree — the branch's
 * current pin, or the town the code was quoted with. The nudges at the end are
 * the part worth understanding: the reference's prefix can land the recovered
 * cell in the block *next door*, so each axis is pulled back by one block when
 * the result sits more than half a block away from where we were told to look.
 *
 * @param {string} code      e.g. "XWW2+45W" or "XWW2+45W, Muse"
 * @param {{lat:number,lng:number}} reference
 */
export function recoverPlusCode(code, reference) {
  const text = String(code ?? '').trim().toUpperCase().split(',')[0].trim().split(/\s+/)[0];
  if (isFullPlusCode(text)) return decodePlusCode(text);
  if (!reference || !Number.isFinite(reference.lat) || !Number.isFinite(reference.lng)) {
    return null;
  }
  const sep = text.indexOf(SEPARATOR);
  if (sep < 0) return null;

  const padding = SEPARATOR_POSITION - sep;
  const prefix = encodePrefix(reference.lat, reference.lng, padding);
  if (prefix === null) return null;

  const area = decodePlusCode(prefix + text);
  if (!area) return null;

  const resolution = BASE ** (2 - padding / 2);
  const half = resolution / 2;
  let { lat, lng } = area;

  if (reference.lat + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (reference.lat - half > lat && lat + resolution <= 90) lat += resolution;

  if (reference.lng + half < lng) lng -= resolution;
  else if (reference.lng - half > lng) lng += resolution;

  return { ...area, lat, lng };
}

/**
 * The first `length` characters of the full code for a point.
 *
 * This is the only piece of encoding the app needs, and it exists solely to
 * supply the characters a short code is missing.
 */
function encodePrefix(lat, lng, length) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || length <= 0) return null;
  const clippedLat = Math.min(Math.max(lat, -90), 90);
  const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;

  let latVal = Math.floor(
    Math.round((clippedLat + 90) * FINAL_LAT_PRECISION * 1e6) / 1e6,
  );
  let lngVal = Math.floor(
    Math.round((wrappedLng + 180) * FINAL_LNG_PRECISION * 1e6) / 1e6,
  );

  /* Only the pair section can appear in a prefix, so the grid digits are
     divided away rather than emitted. */
  latVal = Math.floor(latVal / GRID_ROWS ** (MAX_DIGITS - PAIR_LENGTH));
  lngVal = Math.floor(lngVal / GRID_COLS ** (MAX_DIGITS - PAIR_LENGTH));

  let code = '';
  for (let i = 0; i < PAIR_LENGTH / 2; i += 1) {
    code = ALPHABET[latVal % BASE] + ALPHABET[lngVal % BASE] + code;
    latVal = Math.floor(latVal / BASE);
    lngVal = Math.floor(lngVal / BASE);
  }
  return code.slice(0, length);
}

/**
 * Accept whatever a shop owner actually has in their hand.
 *
 * In practice that is one of two things: a Plus Code copied out of Google Maps
 * ("XWW2+45W, Muse", sometimes without the comma), or a pair of decimals from
 * a phone's compass app. Making them choose the right field first is how the
 * wrong number gets typed into the right box, so one field takes both and the
 * UI shows what it understood.
 *
 * `source` is returned so the screen can say "read as a Plus Code" — silently
 * reinterpreting a typo as coordinates on the other side of the planet is the
 * failure worth guarding against.
 *
 * @param {string} text
 * @param {{lat:number,lng:number}|null} reference  used only to expand a short code
 * @returns {{lat:number,lng:number,source:'plus-code'|'coordinates'}|null}
 */
export function parseLocationInput(text, reference = null) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  if (isPlusCodeish(raw)) {
    const area = isFullPlusCode(raw) ? decodePlusCode(raw) : recoverPlusCode(raw, reference);
    if (area) return { lat: area.lat, lng: area.lng, source: 'plus-code' };
    return null;
  }

  /* "23.9953625, 97.9004531" — comma, semicolon or whitespace separated. */
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, source: 'coordinates' };
}
