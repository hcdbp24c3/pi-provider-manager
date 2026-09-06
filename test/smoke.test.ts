import { describe, test, expect } from "bun:test";
describe("smoke", () => {
  test("bun test works", () => {
    expect(1 + 1).toBe(2);
  });
});