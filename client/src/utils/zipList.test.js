import { describe, expect, test } from "vitest";
import { MAX_COMPARE, formatZipList, mergeSeries, parseZipList } from "./zipList.js";

describe("parseZipList", () => {
  test("reads valid ZIPs in order", () => {
    expect(parseZipList("19104,19103")).toEqual(["19104", "19103"]);
  });

  test("drops invalid entries, blanks and repeats, and trims spaces", () => {
    expect(parseZipList(" 19104, abc ,,1910,19104, 33602 ")).toEqual(["19104", "33602"]);
  });

  test(`keeps at most ${MAX_COMPARE}`, () => {
    expect(parseZipList("11111,22222,33333,44444,55555")).toEqual(["11111", "22222", "33333", "44444"]);
  });

  test("treats a missing parameter as empty", () => {
    expect(parseZipList(null)).toEqual([]);
    expect(parseZipList("")).toEqual([]);
  });

  test("round-trips through formatZipList", () => {
    const zips = ["19104", "19103", "33602"];
    expect(parseZipList(formatZipList(zips))).toEqual(zips);
  });
});

describe("mergeSeries", () => {
  test("lines up readings from different ZIPs by month, oldest first", () => {
    const merged = mergeSeries(
      ["19104", "33602"],
      [
        [
          { trend_date: "2023-02-28", zhvi_value: "200" },
          { trend_date: "2023-01-31", zhvi_value: "100" },
        ],
        [{ trend_date: "2023-02-28", zhvi_value: "500.5" }],
      ]
    );
    expect(merged).toEqual([
      { date: "2023-01", 19104: 100 },
      { date: "2023-02", 19104: 200, 33602: 500.5 },
    ]);
  });

  test("handles a ZIP with no readings", () => {
    expect(mergeSeries(["19104", "33606"], [[{ trend_date: "2023-01-31", zhvi_value: "1" }], []])).toEqual([
      { date: "2023-01", 19104: 1 },
    ]);
  });
});
