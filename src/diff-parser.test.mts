import { describe, expect, it } from "vitest";
import { decodeGitCString, parseDiff } from "./diff-parser.mts";

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

  it("skips malformed hunk headers with non-numeric coordinates", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,1 +x,2 @@
+new line
`;
    expectNoAddedLines(diff);
  });

  it("skips hunk headers with non-numeric new count in mixed token", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1 +1x,2 @@
+new line
`;
    expectNoAddedLines(diff);
  });

  it("handles diffs without trailing newline", () => {
    const diff = `diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,1 +1,2 @@
 unchanged
+new line`;
    const result = parseDiff(diff);
    expect(result.get("backend/x.mts")?.size).toBe(2);
  });

  it("reuses cached line set for repeated file paths", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,1 +1,1 @@
+first line
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -2,1 +2,1 @@
+second line
`;
    const result = parseDiff(diff);
    const lines = result.get("backend/x.mts");
    expect(lines?.size).toBe(2);
    expect(lines?.has(1)).toBe(true);
    expect(lines?.has(2)).toBe(true);
  });

  it("skips hunk headers lacking the expected separator spaces", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@bad
+new line
`;
    expectNoAddedLines(diff);
  });

  it("skips hunk headers missing the trailing context space", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ -1,1 +2
+new line
`;
    expectNoAddedLines(diff);
  });

  it("hits hunk header parser when no trailing space exists for space1", () => {
    const diff = `
diff --git a/backend/x.mts b/backend/x.mts
--- a/backend/x.mts
+++ b/backend/x.mts
@@ x
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
