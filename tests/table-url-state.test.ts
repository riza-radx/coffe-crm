import { describe, expect, it } from "vitest";
import {
  parseSortParam,
  parseTableUrlState,
  serializeSortParam,
  toListQuery,
  type TableUrlConfig,
} from "@/lib/table/table-url-state";

const CONFIG: TableUrlConfig = {
  sortable: ["name", "createdAt"],
  filterKeys: ["status", "city"],
  defaultSort: "createdAt:desc",
};

describe("sort parameter", () => {
  it("round-trips", () => {
    expect(serializeSortParam(parseSortParam("name:asc", CONFIG.sortable))).toBe("name:asc");
    expect(serializeSortParam(parseSortParam("name:desc", CONFIG.sortable))).toBe("name:desc");
  });

  it("defaults to descending when no direction is given", () => {
    expect(parseSortParam("name", CONFIG.sortable)).toEqual([{ id: "name", desc: true }]);
  });

  it("drops a field that is not on the allowlist", () => {
    expect(parseSortParam("passwordHash:asc", CONFIG.sortable)).toEqual([]);
    expect(parseSortParam(null, CONFIG.sortable)).toEqual([]);
  });
});

describe("table state derived from the URL", () => {
  it("uses the defaults for an empty query string", () => {
    const state = parseTableUrlState("", CONFIG);
    expect(state.pagination).toEqual({ pageIndex: 0, pageSize: 25 });
    expect(state.sorting).toEqual([]);
    expect(state.sort).toBe("createdAt:desc");
    expect(state.filters).toEqual({});
  });

  it("maps the 1-based URL page onto the 0-based table index", () => {
    expect(parseTableUrlState("page=3", CONFIG).pagination.pageIndex).toBe(2);
  });

  it("clamps a page size above the server maximum", () => {
    expect(parseTableUrlState("pageSize=100000", CONFIG).pagination.pageSize).toBe(100);
  });

  it("ignores junk page values instead of producing NaN", () => {
    for (const qs of ["page=0", "page=-4", "page=abc", "page=1.5"]) {
      expect(parseTableUrlState(qs, CONFIG).pagination.pageIndex).toBe(0);
    }
  });

  it("falls back to the default sort when the field is not allowlisted", () => {
    const state = parseTableUrlState("sort=passwordHash:asc", CONFIG);
    expect(state.sorting).toEqual([]);
    expect(state.sort).toBe("createdAt:desc");
  });

  it("keeps only the configured filter keys", () => {
    const state = parseTableUrlState("status=ACTIVE&city=Tirana&secret=1", CONFIG);
    expect(state.filters).toEqual({ status: "ACTIVE", city: "Tirana" });
  });

  it("builds the API query object the cache key is built from", () => {
    const state = parseTableUrlState("page=2&pageSize=10&sort=name:asc&status=LEAD", CONFIG);
    expect(toListQuery(state)).toEqual({
      page: 2,
      pageSize: 10,
      sort: "name:asc",
      status: "LEAD",
    });
  });
});
