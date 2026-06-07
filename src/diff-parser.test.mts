import { describe, expect, it } from "vitest";
import { decodeGitCString, parseDiff, runGitDiff } from "./diff-parser.mts";
import { parseDiffWithContent } from "./diff-parser-content.mts";

const SIMPLE_DIFF = `
diff --git a/web/components/Foo.tsx b/web/components/Foo.tsx
index abc..def 100644
--- a/web/components/Foo.tsx
+++ b/web/components/Foo.tsx
@@ -1,3 +1,5 @@
+import React from 'react'
+
 export function Foo() {
-  return null
+  return <div />
 }
+export const BAR = 1
`;

const DELETION_DIFF = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -5,3 +5,0 @@
-deleted line
-deleted line
-deleted line
`;

const MULTI_FILE_DIFF = `
diff --git a/web/components/A.tsx b/web/components/A.tsx
--- a/web/components/A.tsx
+++ b/web/components/A.tsx
@@ -1,1 +1,2 @@
 unchanged
+added
diff --git a/backend/b.mts b/backend/b.mts
--- a/backend/b.mts
+++ b/backend/b.mts
@@ -10,0 +11,1 @@
+new line
`;

function expectNoAddedLines(diff: string): void {
  const lines = parseDiff(diff).get("backend/x.mts");
  expect(!lines || lines.size === 0).toBe(true);
}

describe("parseDiff", () => {
  it("parses added lines from a hunk", () => {
    const result = parseDiff(SIMPLE_DIFF);
    const fooLines = result.get("web/components/Foo.tsx")!;
    expect(fooLines.has(1)).toBe(true);
    expect(fooLines.has(5)).toBe(true);
    expect(fooLines.size).toBe(5);
  });

  it("skips pure-deletion hunks (count=0)", () => {
    const result = parseDiff(DELETION_DIFF);
    const lines = result.get("backend/foo.mts");
    expect(!lines || lines.size === 0).toBe(true);
  });

  it("handles multiple files", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    expect(result.has("web/components/A.tsx")).toBe(true);
    expect(result.has("backend/b.mts")).toBe(true);
    expect(result.get("backend/b.mts")?.has(11)).toBe(true);
  });

  it("skips deleted files (+++ b/dev/null)", () => {
    const diff = `
diff --git a/backend/deleted.mts b/backend/deleted.mts
--- a/backend/deleted.mts
+++ b/dev/null
@@ -1,3 +0,0 @@
-deleted line 1
-deleted line 2
-deleted line 3
`;
    const result = parseDiff(diff);
    expect(result.has("dev/null")).toBe(false);
    expect(result.has("backend/deleted.mts")).toBe(false);
  });

  it("handles hunk headers with trailing section context text", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,3 +1,5 @@ export function Foo() {
+import React from 'react'
+
 export function Foo() {
-  return null
+  return <div />
 }
+export const BAR = 1
`;
    const result = parseDiff(diff);
    expect(result.get("backend/x.mts")?.size).toBe(5);
    expect(result.get("backend/x.mts")?.has(1)).toBe(true);
    expect(result.get("backend/x.mts")?.has(5)).toBe(true);
  });

  it("handles comma-less hunk lines (single-line change)", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1 +1 @@
-old
+new
`;
    const result = parseDiff(diff);
    expect(result.get("backend/x.mts")?.has(1)).toBe(true);
  });

  it("does not misclassify content lines starting with +++ b/ as file headers", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -1,1 +1,2 @@
 unchanged
+++ b/this-is-content-not-a-header
`;
    const result = parseDiff(diff);
    expect(result.has("backend/foo.mts")).toBe(true);
    expect(result.has("this-is-content-not-a-header")).toBe(false);
    expect(result.get("backend/foo.mts")?.has(2)).toBe(true);
  });

  it("skips malformed hunk header lines (@@ with no valid pattern)", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ bad hunk header @@
+new line
`;
    const result = parseDiff(diff);
    // malformed @@ line is skipped; no lines added
    const lines = result.get("backend/x.mts");
    expect(!lines || lines.size === 0).toBe(true);
  });

  it("skips malformed hunk headers with non-numeric old-side values", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -x +1,2 @@
+new line
`;
    expectNoAddedLines(diff);
  });

  it("skips hunk headers with malformed old-side counts", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,x +1,2 @@
+new line
`;
    expectNoAddedLines(diff);
  });

  it("skips hunk headers missing the closing @@ marker", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1 +1,2 @
+new line
`;
    expectNoAddedLines(diff);
  });

  it("handles git-quoted paths (core.quotePath=true)", () => {
    const diff = `
diff --git "a/backend/caf\\303\\251.mts" "b/backend/caf\\303\\251.mts"
--- "a/backend/caf\\303\\251.mts"
+++ "b/backend/caf\\303\\251.mts"
@@ -1,1 +1,2 @@
 existing
+new line
`;
    const result = parseDiff(diff);
    expect(result.has("backend/café.mts")).toBe(true);
    expect(result.get("backend/café.mts")?.has(2)).toBe(true);
  });
});

describe("decodeGitCString", () => {
  it("returns plain ASCII unchanged", () => {
    expect(decodeGitCString("backend/foo.mts")).toBe("backend/foo.mts");
  });

  it("decodes octal UTF-8 byte sequences", () => {
    expect(decodeGitCString("caf\\303\\251.mts")).toBe("café.mts");
  });

  it("decodes backslash and double-quote escapes", () => {
    expect(decodeGitCString('path\\\\to\\"file')).toBe('path\\to"file');
  });

  it("decodes \\n and \\t escapes", () => {
    expect(decodeGitCString("line\\nbreak")).toBe("line\nbreak");
    expect(decodeGitCString("tab\\there")).toBe("tab\there");
  });

  it("passes through unknown escape sequences unchanged", () => {
    expect(decodeGitCString("\\z")).toBe("\\z");
  });
});

describe("parseDiff with CRLF and trailing spaces", () => {
  it("correctly handles CRLF and trailing spaces", () => {
    const rawDiff =
      "diff --git a/foo b/foo\r\n--- a/foo\r\n+++ b/foo\r\n@@ -1,1 +1,1 @@\r\n-foo \r\n+bar \t\r\n";
    const res = parseDiff(rawDiff);
    expect([...(res.get("foo") ?? [])]).toEqual([1]);
  });
});

describe("parseDiff with text not ending in newline", () => {
  it("handles text not ending in newline", () => {
    const rawDiff = "diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1,1 +1,1 @@\n-foo\n+bar";
    const res = parseDiff(rawDiff);
    expect([...(res.get("foo") ?? [])]).toEqual([1]);
  });
});

describe("parseDiffWithContent", () => {
  it("captures trimmed source text for added lines (basic)", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("line one");
    expect(file.get(2)).toBe("line two");
    expect(file.get(3)).toBe("line three");
    expect(file.size).toBe(3);
  });

  it("does not advance cursor for removed lines", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -1,2 +1,2 @@
-old line 1
+new line 1
-old line 2
+new line 2
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("new line 1");
    expect(file.get(2)).toBe("new line 2");
    expect(file.size).toBe(2);
  });

  it("stores empty string for blank added lines", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -0,0 +1,2 @@
+non-blank
+
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("non-blank");
    expect(file.get(2)).toBe("");
  });

  it("trims leading whitespace and tabs from added lines", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -0,0 +1,2 @@
+  const indented = 1
+\tconst tabbed = 2
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("const indented = 1");
    expect(file.get(2)).toBe("const tabbed = 2");
  });

  it("resets cursor correctly across multiple hunks in one file", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -1,1 +1,1 @@
-old
+new at line 1
@@ -10,0 +10,1 @@
+new at line 10
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("new at line 1");
    expect(file.get(10)).toBe("new at line 10");
    expect(file.size).toBe(2);
  });

  it("handles multiple files", () => {
    const diff = `
diff --git a/backend/a.mts b/backend/a.mts
--- a/backend/a.mts
+++ b/backend/a.mts
@@ -0,0 +1,1 @@
+line in a
diff --git a/web/b.tsx b/web/b.tsx
--- a/web/b.tsx
+++ b/web/b.tsx
@@ -0,0 +1,1 @@
+line in b
`;
    const result = parseDiffWithContent(diff);
    expect(result.get("backend/a.mts")?.get(1)).toBe("line in a");
    expect(result.get("web/b.tsx")?.get(1)).toBe("line in b");
  });

  it("skips pure-deletion hunks (count=0)", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -5,3 +5,0 @@
-deleted line
-deleted line
-deleted line
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/foo.mts");
    expect(!file || file.size === 0).toBe(true);
  });

  it("skips deleted files (+++ b/dev/null)", () => {
    const diff = `
diff --git a/backend/deleted.mts b/backend/deleted.mts
--- a/backend/deleted.mts
+++ b/dev/null
@@ -1,3 +0,0 @@
-deleted line 1
-deleted line 2
-deleted line 3
`;
    const result = parseDiffWithContent(diff);
    expect(result.has("dev/null")).toBe(false);
    expect(result.has("backend/deleted.mts")).toBe(false);
  });

  it("does not misclassify content lines starting with +++ b/ as file headers", () => {
    const diff = `
diff --git a/backend/foo.mts b/backend/foo.mts
--- a/backend/foo.mts
+++ b/backend/foo.mts
@@ -0,0 +1,2 @@
+first
+++ b/this-is-content-not-a-header
`;
    const result = parseDiffWithContent(diff);
    expect(result.has("backend/foo.mts")).toBe(true);
    expect(result.has("this-is-content-not-a-header")).toBe(false);
    const file = result.get("backend/foo.mts")!;
    expect(file.get(1)).toBe("first");
    expect(file.get(2)).toBe("++ b/this-is-content-not-a-header");
  });

  it("skips malformed hunk header lines and ignores subsequent content", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ bad hunk header @@
+new line
`;
    const result = parseDiffWithContent(diff);
    const file = result.get("backend/x.mts");
    expect(!file || file.size === 0).toBe(true);
  });

  it("handles git-quoted paths (core.quotePath=true)", () => {
    const diff = `
diff --git "a/backend/caf\\303\\251.mts" "b/backend/caf\\303\\251.mts"
--- "a/backend/caf\\303\\251.mts"
+++ "b/backend/caf\\303\\251.mts"
@@ -1,0 +2,1 @@
+new line
`;
    const result = parseDiffWithContent(diff);
    expect(result.has("backend/café.mts")).toBe(true);
    expect(result.get("backend/café.mts")?.get(2)).toBe("new line");
  });

  it("correctly handles CRLF and trailing spaces in content lines", () => {
    const rawDiff =
      "diff --git a/foo b/foo\r\n--- a/foo\r\n+++ b/foo\r\n@@ -0,0 +1,1 @@\r\n+bar \t\r\n";
    const result = parseDiffWithContent(rawDiff);
    expect(result.get("foo")?.get(1)).toBe("bar");
  });

  it("handles diff text not ending in a newline", () => {
    const rawDiff = "diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -0,0 +1,1 @@\n+bar";
    const result = parseDiffWithContent(rawDiff);
    expect(result.get("foo")?.get(1)).toBe("bar");
  });

  it("handles single-line hunk (no comma in @@ header)", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1 +1 @@
-old
+new
`;
    const result = parseDiffWithContent(diff);
    expect(result.get("backend/x.mts")?.get(1)).toBe("new");
  });
});

describe("runGitDiff", () => {
  it("throws an error if baseRef starts with a hyphen", async () => {
    await expect(runGitDiff("-main", "HEAD")).rejects.toThrow(
      "Invalid git reference: cannot start with a hyphen",
    );
  });

  it("throws an error if headRef starts with a hyphen", async () => {
    await expect(runGitDiff("main", "-HEAD")).rejects.toThrow(
      "Invalid git reference: cannot start with a hyphen",
    );
  });
});
