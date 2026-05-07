/**
 * Approximate lat/lng for major U.S. cities present in the Yelp Open Dataset
 * (and a handful of common neighbours). Used by MapPage to place city
 * bubbles. Add more entries here as the dataset grows.
 *
 * Numbers are city centroids accurate to ~1 mile, which is plenty for a
 * national-scale bubble map.
 */
const CITY_COORDS = {
  "Philadelphia":   { lat: 39.9526, lng: -75.1652, state: "PA" },
  "Tucson":         { lat: 32.2226, lng: -110.9747, state: "AZ" },
  "Tampa":          { lat: 27.9506, lng: -82.4572, state: "FL" },
  "Indianapolis":   { lat: 39.7684, lng: -86.1581, state: "IN" },
  "Nashville":      { lat: 36.1627, lng: -86.7816, state: "TN" },
  "New Orleans":    { lat: 29.9511, lng: -90.0715, state: "LA" },
  "Reno":           { lat: 39.5296, lng: -119.8138, state: "NV" },
  "Edmonton":       { lat: 53.5461, lng: -113.4938, state: "AB" },
  "Saint Louis":    { lat: 38.6270, lng: -90.1994, state: "MO" },
  "St. Louis":      { lat: 38.6270, lng: -90.1994, state: "MO" },
  "Boise":          { lat: 43.6150, lng: -116.2023, state: "ID" },
  "Santa Barbara":  { lat: 34.4208, lng: -119.6982, state: "CA" },
  "Las Vegas":      { lat: 36.1699, lng: -115.1398, state: "NV" },
  "Phoenix":        { lat: 33.4484, lng: -112.0740, state: "AZ" },
  "Charlotte":      { lat: 35.2271, lng: -80.8431, state: "NC" },
  "Cleveland":      { lat: 41.4993, lng: -81.6944, state: "OH" },
  "Pittsburgh":     { lat: 40.4406, lng: -79.9959, state: "PA" },
  "Madison":        { lat: 43.0731, lng: -89.4012, state: "WI" },
  "Toronto":        { lat: 43.6532, lng: -79.3832, state: "ON" },
  "Calgary":        { lat: 51.0447, lng: -114.0719, state: "AB" },
  "Mississauga":    { lat: 43.5890, lng: -79.6441, state: "ON" },
  "Henderson":      { lat: 36.0395, lng: -114.9817, state: "NV" },
  "Mesa":           { lat: 33.4152, lng: -111.8315, state: "AZ" },
  "Scottsdale":     { lat: 33.4942, lng: -111.9261, state: "AZ" },
  "Gilbert":        { lat: 33.3528, lng: -111.7890, state: "AZ" },
  "Chandler":       { lat: 33.3062, lng: -111.8413, state: "AZ" },
  "Glendale":       { lat: 33.5387, lng: -112.1860, state: "AZ" },
  "Peoria":         { lat: 33.5806, lng: -112.2374, state: "AZ" },
  "Surprise":       { lat: 33.6292, lng: -112.3680, state: "AZ" },
  "Goodyear":       { lat: 33.4353, lng: -112.3576, state: "AZ" },
  "Fort Lauderdale":{ lat: 26.1224, lng: -80.1373, state: "FL" },
  "Kissimmee":      { lat: 28.2920, lng: -81.4076, state: "FL" },
  "Orlando":        { lat: 28.5383, lng: -81.3792, state: "FL" },
  "Brandon":        { lat: 27.9378, lng: -82.2860, state: "FL" },
  "Clearwater":     { lat: 27.9659, lng: -82.8001, state: "FL" },
  "St. Petersburg": { lat: 27.7676, lng: -82.6403, state: "FL" },
  "Lakeland":       { lat: 28.0395, lng: -81.9498, state: "FL" },
  "Sarasota":       { lat: 27.3364, lng: -82.5307, state: "FL" },
  "Wilmington":     { lat: 39.7391, lng: -75.5398, state: "DE" },
  "Cherry Hill":    { lat: 39.9348, lng: -75.0307, state: "NJ" },
  "King of Prussia":{ lat: 40.0894, lng: -75.3960, state: "PA" },
  "Camden":         { lat: 39.9259, lng: -75.1196, state: "NJ" },
  "Goose Creek":    { lat: 32.9810, lng: -80.0326, state: "SC" },
  "North Charleston":{ lat: 32.8546, lng: -79.9748, state: "SC" },
  "Mount Pleasant": { lat: 32.7942, lng: -79.8625, state: "SC" },
  "Summerville":    { lat: 33.0185, lng: -80.1756, state: "SC" },
};

/**
 * Returns the centroid for a city name (case-insensitive). null if unknown.
 * @param {string} cityName
 */
export function lookupCity(cityName) {
  if (!cityName) return null;
  const direct = CITY_COORDS[cityName];
  if (direct) return direct;
  const lower = cityName.toLowerCase();
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

export default CITY_COORDS;
