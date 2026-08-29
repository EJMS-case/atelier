// ── MARKDOWN LITE ────────────────────────────────────────────────────────────
// Tiny dependency-free renderer for the stylist chat's light markdown:
// paragraphs, **bold**, *italic*, and dash/numbered lists. Deliberately no
// headers, links, or HTML — the chat prompt only invites bold + short lists,
// and everything renders as React elements (no innerHTML).

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

function renderInline(text, keyBase) {
  return String(text).split(INLINE_RE).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={`${keyBase}-${i}`}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const BULLET_RE = /^\s*[-•]\s+/;
const NUMBER_RE = /^\s*\d+[.)]\s+/;

export default function MarkdownLite({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let list = null; // { ordered, items }

  const flushList = () => {
    if (list) { blocks.push(list); list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (BULLET_RE.test(line) || NUMBER_RE.test(line)) {
      const ordered = NUMBER_RE.test(line);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(line.replace(BULLET_RE, "").replace(NUMBER_RE, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push({ text: line });
    }
  }
  flushList();

  return (
    <>
      {blocks.map((b, i) => {
        if (b.items) {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} style={{ margin: "4px 0", paddingLeft: 18 }}>
              {b.items.map((item, j) => (
                <li key={j} style={{ marginBottom: 2 }}>{renderInline(item, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} style={{ margin: i === blocks.length - 1 ? 0 : "0 0 6px", whiteSpace: "pre-wrap" }}>
            {renderInline(b.text, i)}
          </p>
        );
      })}
    </>
  );
}
