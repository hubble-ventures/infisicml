import { describe, expect, it } from "vitest";
import { serializeDotenv } from "../src/core/index.js";

describe("serializeDotenv", () => {
  it("writes bare values that are safe", () => {
    expect(serializeDotenv({ A: "simple-value_1" })).toBe("A=simple-value_1\n");
  });

  it("quotes and escapes values with special characters", () => {
    expect(serializeDotenv({ A: 'a "b" c' })).toBe('A="a \\"b\\" c"\n');
    expect(serializeDotenv({ A: "line1\nline2" })).toBe('A="line1\\nline2"\n');
  });

  it("quotes empty values", () => {
    expect(serializeDotenv({ A: "" })).toBe('A=""\n');
  });

  it("returns empty string for no vars", () => {
    expect(serializeDotenv({})).toBe("");
  });
});
