import { describe, expect, it, vi } from "vitest";
import { upsertComment, type GhRunner } from "./github-comment.mts";
import { COMMENT_MARKER } from "./report.mts";

function makeGh(responses: Record<string, string>): GhRunner & ReturnType<typeof vi.fn> {
  const impl: GhRunner = (args) => {
    const key = args.join(" ");
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) return Promise.resolve(response);
    }
    return Promise.resolve("");
  };
  return vi.fn<typeof impl>(impl) as GhRunner & ReturnType<typeof vi.fn>;
}

const FAIL_BODY = `${COMMENT_MARKER}\n## failed`;

describe("upsertComment", () => {
  it("posts a new comment on failure when none exists", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "" });
    await upsertComment(FAIL_BODY, "owner/repo", 42, false, gh);
    const calls = gh.mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("issues/42/comments") && !c.includes("PATCH"))).toBe(true);
  });

  it("patches an existing comment on failure", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "99\n" });
    await upsertComment(FAIL_BODY, "owner/repo", 42, false, gh);
    const calls = gh.mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("comments/99") && c.includes("PATCH"))).toBe(true);
  });

  it("deletes an existing comment on pass", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "99\n" });
    await upsertComment("", "owner/repo", 42, true, gh);
    const calls = gh.mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("comments/99") && c.includes("DELETE"))).toBe(true);
  });

  it("does nothing on pass when no prior comment exists", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "" });
    await upsertComment("", "owner/repo", 42, true, gh);
    expect(gh.mock.calls.length).toBe(1);
  });

  it("finds comment id when paginate produces null on first page then id on second", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "\n99\n" });
    await upsertComment(FAIL_BODY, "owner/repo", 42, false, gh);
    const calls = gh.mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("comments/99") && c.includes("PATCH"))).toBe(true);
  });

  it("falls back to POST and does not throw when comment lookup fails", async () => {
    const lookupErrorGh = vi.fn<GhRunner>((args) =>
      args.includes("--paginate") ? Promise.reject(new Error("API error")) : Promise.resolve(""),
    );
    await expect(
      upsertComment(FAIL_BODY, "owner/repo", 42, false, lookupErrorGh),
    ).resolves.toBeUndefined();
    const calls = lookupErrorGh.mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("issues/42/comments") && !c.includes("PATCH"))).toBe(true);
  });

  it("throws an error when repository format is invalid", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "" });
    await expect(upsertComment(FAIL_BODY, "-invalid/repo", 42, false, gh)).rejects.toThrow(
      "Invalid repository format: -invalid/repo. Expected owner/repo.",
    );
    await expect(
      upsertComment(FAIL_BODY, "owner-without-slash-repo", 42, false, gh),
    ).rejects.toThrow("Invalid repository format: owner-without-slash-repo. Expected owner/repo.");
    await expect(upsertComment(FAIL_BODY, "owner/.", 42, false, gh)).rejects.toThrow(
      "Invalid repository format: owner/.. Expected owner/repo.",
    );
    await expect(upsertComment(FAIL_BODY, "owner/..", 42, false, gh)).rejects.toThrow(
      "Invalid repository format: owner/... Expected owner/repo.",
    );
  });

  it("accepts a leading-hyphen repo segment after trimming", async () => {
    const gh = makeGh({ "issues/42/comments --paginate": "" });
    await expect(upsertComment(FAIL_BODY, " owner/-repo ", 42, false, gh)).resolves.toBeUndefined();
  });
});
