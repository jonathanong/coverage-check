import { describe, expect, it } from "vitest";
import { coverageDisposition, executableLineNumbers } from "./scope.mts";

const scope = {
  version: 1 as const,
  analyzer: "javascript" as const,
  include: ["src/**/*.{ts,tsx}"],
  ignored: ["src/generated/**"],
  supplemental: ["src/types.ts"],
};

describe("coverage scope", () => {
  it("applies ignored, supplemental, aggregate, and outside-scope dispositions", () => {
    expect(coverageDisposition("src/generated/a.ts", scope)).toBe("ignored");
    expect(coverageDisposition("src/types.ts", scope)).toBe("supplemental");
    expect(coverageDisposition("src/a.ts", scope)).toBe("aggregate");
    expect(coverageDisposition("docs/a.ts", scope)).toBe("ignored");
  });

  it("identifies emitted lines but omits types, comments, and import continuations", () => {
    const lines = executableLineNumbers(
      `import defaultThing, {\n  thing,\n} from "./thing.ts";\n// comment\ntype Shape = { x: number };\nexport const value = thing ?? defaultThing;\n`,
      "src/a.ts",
    );
    expect([...lines]).toContain(6);
    expect([...lines]).not.toContain(2);
    expect([...lines]).not.toContain(4);
    expect([...lines]).not.toContain(5);
  });
});
