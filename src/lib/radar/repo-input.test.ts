import { describe, expect, it } from "vitest";
import { parseRepoInput } from "./repo-input";

describe("parseRepoInput", () => {
  it.each([
    "vercel/next.js",
    "  vercel/next.js  ",
    "github.com/vercel/next.js",
    "https://github.com/vercel/next.js",
    "https://www.github.com/vercel/next.js/",
    "https://github.com/vercel/next.js/issues/123",
    "https://github.com/vercel/next.js.git",
    "git@github.com:vercel/next.js.git",
  ])("parses %j", (input) => {
    expect(parseRepoInput(input)).toEqual({ owner: "vercel", name: "next.js" });
  });

  it.each(["", "vercel", "vercel/", "/next.js", "-bad/repo", "owner/..", "https://gitlab.com/a/b", "a b/c"])(
    "rejects %j",
    (input) => {
      expect(parseRepoInput(input)).toBeNull();
    },
  );
});
