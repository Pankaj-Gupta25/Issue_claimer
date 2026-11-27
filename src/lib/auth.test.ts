import { describe, expect, it } from "vitest";
import { checkBasicAuth, parseBasicAuth, safeEqual } from "./auth";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;

describe("checkBasicAuth", () => {
  it("accepts the right credentials", () => {
    expect(checkBasicAuth(basic("admin:correct horse"), "admin", "correct horse")).toBe(true);
  });

  it("rejects a wrong user or password", () => {
    expect(checkBasicAuth(basic("admin:nope"), "admin", "correct horse")).toBe(false);
    expect(checkBasicAuth(basic("someone:correct horse"), "admin", "correct horse")).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(checkBasicAuth(null, "u", "p")).toBe(false);
    expect(checkBasicAuth("Bearer abc", "u", "p")).toBe(false);
    expect(checkBasicAuth("Basic", "u", "p")).toBe(false);
    expect(checkBasicAuth(basic("no-colon"), "u", "p")).toBe(false);
  });
});

describe("parseBasicAuth", () => {
  it("keeps colons and non-ASCII characters in the password", () => {
    expect(parseBasicAuth(basic("me:pa:ss:wörd"))).toEqual({ user: "me", password: "pa:ss:wörd" });
  });
});

describe("safeEqual", () => {
  it("compares strings of different lengths without throwing", () => {
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
