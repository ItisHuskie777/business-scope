import { describe, expect, test } from "vitest";
import CITY_COORDS, { lookupCity } from "./cityCoords.js";

describe("lookupCity", () => {
  test("finds a city by its exact name", () => {
    expect(lookupCity("Philadelphia")).toEqual({ lat: 39.9526, lng: -75.1652, state: "PA" });
  });

  test("ignores case", () => {
    expect(lookupCity("philadelphia")).toEqual(lookupCity("Philadelphia"));
    expect(lookupCity("NEW ORLEANS")).toEqual(lookupCity("New Orleans"));
  });

  test("returns null for an unknown or missing name", () => {
    expect(lookupCity("Atlantis")).toBeNull();
    expect(lookupCity("")).toBeNull();
    expect(lookupCity(undefined)).toBeNull();
  });
});

describe("CITY_COORDS", () => {
  test("every entry is a plausible North American coordinate", () => {
    for (const [city, { lat, lng, state }] of Object.entries(CITY_COORDS)) {
      expect(lat, city).toBeGreaterThan(24);
      expect(lat, city).toBeLessThan(60);
      expect(lng, city).toBeLessThan(-60);
      expect(lng, city).toBeGreaterThan(-130);
      expect(state, city).toMatch(/^[A-Z]{2}$/);
    }
  });
});
