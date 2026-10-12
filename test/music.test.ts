import { describe, expect, test } from "bun:test";
import { BarGrid, durationTicks, parsePitch, pitchName, positionTicks, tickToSeconds } from "../src/model/music.ts";

describe("pitch", () => {
  test("C4 is MIDI 60 (scientific notation, not Yamaha's C3)", () => {
    expect(parsePitch("C4")).toBe(60);
    expect(parsePitch("A4")).toBe(69);
    expect(parsePitch("F#5")).toBe(78);
    expect(parsePitch("Bb3")).toBe(58);
    expect(parsePitch("C-1")).toBe(0);
    expect(parsePitch(64)).toBe(64);
  });
  test("round-trips names", () => {
    for (let m = 0; m < 128; m++) expect(parsePitch(pitchName(m))).toBe(m);
  });
  test("rejects garbage", () => {
    expect(() => parsePitch("H4")).toThrow();
    expect(() => parsePitch(128)).toThrow();
  });
});

describe("time", () => {
  const grid44 = new BarGrid([{ bar: 1, numerator: 4, denominator: 4 }]);
  test("bar:beat is 1-based", () => {
    expect(positionTicks("1:1", grid44)).toBe(0);
    expect(positionTicks("2:1", grid44)).toBe(1920);
    expect(positionTicks("2:2.5", grid44)).toBe(1920 + 720);
  });
  test("numbers are quarter notes", () => {
    expect(positionTicks(4, grid44)).toBe(1920);
    expect(durationTicks(0.5)).toBe(240);
  });
  test("fractions are of a whole note", () => {
    expect(durationTicks("1/4")).toBe(480);
    expect(durationTicks("1/8")).toBe(240);
    expect(durationTicks("3/8")).toBe(720);
  });
  test("time signature changes move bar starts; beat unit follows the denominator", () => {
    const grid = new BarGrid([
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 3, numerator: 6, denominator: 8 },
    ]);
    expect(positionTicks("3:1", grid)).toBe(3840);
    expect(positionTicks("4:1", grid)).toBe(3840 + 1440);
    expect(positionTicks("3:2", grid)).toBe(3840 + 240);
    expect(grid.label(3840 + 240)).toBe("3:2");
  });
  test("beats beyond the bar are rejected", () => {
    expect(() => positionTicks("1:5", grid44)).toThrow();
  });
  test("tempo map", () => {
    expect(tickToSeconds(1920, [{ tick: 0, bpm: 120 }])).toBeCloseTo(2);
    expect(tickToSeconds(1920, [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }])).toBeCloseTo(1 + 2);
  });
});
