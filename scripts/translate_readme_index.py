#!/usr/bin/env python3
"""Translate README.md via Bilibili's free Index-Translate API.

Official free endpoint: https://index-translate.bilibili.com/v1 (OpenAI-compatible,
no API key required). The model emits chain-of-thought unless the hidden
``chat_template_kwargs.enable_thinking=false`` parameter is sent, so every request
carries it (plus a defensive <think> stripper as a safety net).

Translation is incremental. The source README is split into blank-line separated
blocks plus atomic fenced code blocks; items without CJK text are copied
verbatim. An item is sent to the API only when its source hash is not present in
the previous run's ``.index-translate-state.json`` (next to the translated
file). Everything else is read back from the existing translation, so an edited
paragraph produces an edited paragraph in the diff instead of a whole-file
rewrite. Fenced code blocks are translated as units with a prompt that only
allows comment text to change.

The translated README stays the source of truth for block text: unchanged blocks
are reused from that file, which keeps manual wording fixes across runs. The
state file only records the ordered source hashes used to align the previous run.

Usage:
    python scripts/translate_readme_index.py --lang en
    python scripts/translate_readme_index.py --lang en --preview   # first chunk only
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from urllib.parse import urlsplit, urlunsplit

API_BASE = os.environ.get("INDEX_TRANSLATE_API_BASE", "https://index-translate.bilibili.com/v1")
MODEL = os.environ.get("INDEX_TRANSLATE_MODEL", "Index-Translate-35B-A3B")
SOURCE = "README.md"
STATE_FILE = ".index-translate-state.json"
STATE_SCHEMA = 1

LANG_NAMES = {"en": "English", "zh": "Chinese", "ja": "Japanese"}
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
FENCED_BLOCK_RE = re.compile(
    r"(?ms)(^[ \t]*(?:```|~~~)[^\n]*\n.*?^[ \t]*(?:```|~~~)[ \t]*$)"
)
HTML_LINK_RE = re.compile(
    r"(?P<prefix>\b(?:href|src)\s*=\s*[\"'])(?P<target>[^\"']+)(?P<suffix>[\"'])",
    re.IGNORECASE,
)
MARKDOWN_LINK_RE = re.compile(
    r"(?P<prefix>!?\[[^\]]*\]\()(?P<target><[^>]+>|[^)\s]+)(?P<suffix>[^)]*\))"
)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")


def split_chunks(text):
    """Split markdown by '## ' section headers; preamble becomes chunk 0."""
    parts = re.split(r"(?m)^(?=## )", text)
    return [p for p in parts if p.strip()]


def tokenize(text):
    """Split markdown into ordered sep/block/fence items.

    Separators keep the exact whitespace between blocks, so the generated file
    reproduces the source layout byte for byte outside translated blocks.
    """
    items = []
    position = 0
    for match in FENCED_BLOCK_RE.finditer(text):
        items.extend(_split_text(text[position:match.start()]))
        items.append({"kind": "fence", "text": match.group(0)})
        position = match.end()
    items.extend(_split_text(text[position:]))
    return items


def _split_text(text):
    items = []
    for index, part in enumerate(re.split(r"(\n[ \t]*\n)", text)):
        if not part:
            continue
        items.append({"kind": "sep" if index % 2 else "block", "text": part})
    return items


def content_items(items):
    """Items that map one-to-one to output blocks (separators excluded)."""
    return [item for item in items if item["kind"] != "sep"]


def item_hash(item):
    return hashlib.sha256(item["text"].rstrip("\n").encode("utf-8")).hexdigest()[:16]


def has_cjk(text):
    return CJK_RE.search(text) is not None


def block_shape(block):
    head = block.lstrip()
    if head.startswith("|"):
        return "table"
    if head.startswith("#"):
        return "heading-%d" % (len(head) - len(head.lstrip("#")))
    if re.match(r"(?:[-*+]|\d+[.)])\s", head):
        return "list"
    if head.startswith("<"):
        return "html"
    if head.startswith(">"):
        return "quote"
    return "paragraph"


def _anchor_signature(text):
    """Non-translatable anchors: link targets and inline code spans.

    In-page fragments (``#features``) are excluded: translated headings change
    them, so they cannot be used to decide whether two blocks correspond.
    """
    targets = [match.group("target") for match in HTML_LINK_RE.finditer(text)]
    targets.extend(match.group("target") for match in MARKDOWN_LINK_RE.finditer(text))
    targets = [target for target in targets if not target.strip().startswith("#")]
    return sorted(targets), sorted(INLINE_CODE_RE.findall(text))


def _same_anchors(source_block, translated_block, source_path, output_path):
    rewritten = rewrite_relative_links(source_block, source_path, output_path)
    return _anchor_signature(rewritten) == _anchor_signature(translated_block)


def _portable(path):
    return os.path.normpath(path).replace(os.sep, "/")


def log(message):
    print(message, file=sys.stderr)


def build_prompt(chunk, target):
    tgt = LANG_NAMES.get(target, target)
    return (
        "Translate the following Markdown fragment from Chinese to " + tgt + ". "
        "The fragment may be a heading, a paragraph, a list, a table, an HTML "
        "block, or a block quote. Rules:\n"
        "1. Keep Markdown structure identical: same headings, same number of list "
        "items, same table rows and columns, same block quotes;\n"
        "2. Keep inline code exactly as-is, do not translate it;\n"
        "3. For links, translate only the display text; keep URLs unchanged. "
        "Image alt text may be translated, src stays;\n"
        "4. Keep HTML tags, attributes, classes, and badge markup as-is; translate "
        "only Chinese text inside tags;\n"
        "5. Preserve emoji and do not add or remove blank lines;\n"
        "6. Output only the translation, with no code fence around it and no "
        "explanations.\n\n"
        "[Content to translate]\n" + chunk.strip()
    )


def strip_think(text):
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip().removeprefix("<think>").strip()


def build_fence_prompt(fence, target):
    tgt = LANG_NAMES.get(target, target)
    return (
        "Translate the human-readable comments and prose lines in this fenced "
        "code block from Chinese to " + tgt + ". Rules:\n"
        "1. Keep the opening and closing fence markers, the language tag, "
        "indentation, blank lines, commands, identifiers, paths, and all code "
        "exactly as-is;\n"
        "2. Translate only comment text (after a comment marker such as # or //) "
        "and prose descriptions such as directory-tree labels;\n"
        "3. Keep URLs, version numbers, and inline code unchanged;\n"
        "4. Output only the complete code block, with no explanation.\n\n"
        "[Content to translate]\n" + fence.strip()
    )


COMMENT_MARKERS = ("#", "//", "/*", "*", "<!--")


def _comment_start(line):
    if line.lstrip().startswith(COMMENT_MARKERS):
        return 0
    positions = [line.find(marker) for marker in (" #", " //", " /*")]
    positions = [position for position in positions if position != -1]
    return min(positions) if positions else None


def fence_skeleton(text):
    """Code-only shape of a fence; used to tell whether code changed."""
    skeleton = []
    for line in text.splitlines():
        cut = _comment_start(line)
        skeleton.append((line if cut is None else line[:cut]).rstrip())
    return skeleton


def fence_marker(text):
    lines = text.splitlines()
    if not lines:
        return None
    match = re.match(r"[ \t]*(`{3,}|~{3,})", lines[0])
    return match.group(1) if match else None


def is_valid_fence(original, translated):
    marker = fence_marker(original)
    if marker is None:
        return False
    lines = translated.splitlines()
    if len(lines) < 2:
        return False
    char = re.escape(marker[0])
    quantifier = "{%d,}" % len(marker)
    open_re = re.compile(r"^[ \t]*" + char + quantifier)
    close_re = re.compile(r"^[ \t]*" + char + quantifier + r"[ \t]*$")
    if not (open_re.match(lines[0]) and close_re.match(lines[-1])):
        return False
    # Code lines must survive unchanged; only comment text may differ. Prose
    # without a comment marker cannot be compared reliably, so skip that case.
    source_skeleton = fence_skeleton(original)
    if any(has_cjk(line) for line in source_skeleton):
        return True
    return source_skeleton == fence_skeleton(translated)


def _rewrite_relative_target(target, source_path, output_path):
    """Resolve a source-relative link from the translated file's directory."""
    wrapped = target.startswith("<") and target.endswith(">")
    raw_target = target[1:-1] if wrapped else target
    parsed = urlsplit(raw_target)
    if (
        not parsed.path
        or parsed.scheme
        or parsed.netloc
        or parsed.path.startswith(("/", "//"))
    ):
        return target

    source_path = os.path.normpath(source_path)
    output_path = os.path.normpath(output_path)
    source_dir = os.path.dirname(source_path) or "."
    output_dir = os.path.dirname(output_path) or "."
    source_target = os.path.normpath(
        os.path.join(source_dir, parsed.path.replace("/", os.sep))
    )

    # A translated README's language switch should point back to its source,
    # not back to the translated file that the source README links to.
    if os.path.normcase(source_target) == os.path.normcase(output_path):
        resolved = os.path.relpath(source_path, output_dir)
    else:
        resolved = os.path.relpath(source_target, output_dir)
    resolved = resolved.replace(os.sep, "/")
    if parsed.path.endswith("/") and not resolved.endswith("/"):
        resolved += "/"

    rewritten = urlunsplit(("", "", resolved, parsed.query, parsed.fragment))
    return "<" + rewritten + ">" if wrapped else rewritten


def _unrewrite_relative_target(target, source_path, output_path):
    """Inverse of _rewrite_relative_target: output-relative -> source-relative."""
    wrapped = target.startswith("<") and target.endswith(">")
    raw_target = target[1:-1] if wrapped else target
    parsed = urlsplit(raw_target)
    if (
        not parsed.path
        or parsed.scheme
        or parsed.netloc
        or parsed.path.startswith(("/", "//"))
    ):
        return target

    source_path = os.path.normpath(source_path)
    output_path = os.path.normpath(output_path)
    source_dir = os.path.dirname(source_path) or "."
    output_dir = os.path.dirname(output_path) or "."
    resolved = os.path.normpath(
        os.path.join(output_dir, parsed.path.replace("/", os.sep))
    )

    # Inverse of the language-switch special case: a link back to the source
    # file becomes the source README's link to this translation.
    if os.path.normcase(resolved) == os.path.normcase(source_path):
        mapped = os.path.relpath(output_path, source_dir)
    else:
        mapped = os.path.relpath(resolved, source_dir)
    mapped = mapped.replace(os.sep, "/")
    if parsed.path.endswith("/") and not mapped.endswith("/"):
        mapped += "/"

    rewritten = urlunsplit(("", "", mapped, parsed.query, parsed.fragment))
    return "<" + rewritten + ">" if wrapped else rewritten


def _map_links(text, map_target):
    """Apply a target mapper to every link outside fenced code."""
    def rewrite_segment(segment):
        def rewrite_html(match):
            target = map_target(match.group("target"))
            return match.group("prefix") + target + match.group("suffix")

        def rewrite_markdown(match):
            target = map_target(match.group("target"))
            return match.group("prefix") + target + match.group("suffix")

        segment = HTML_LINK_RE.sub(rewrite_html, segment)
        return MARKDOWN_LINK_RE.sub(rewrite_markdown, segment)

    parts = FENCED_BLOCK_RE.split(text)
    return "".join(
        part if index % 2 else rewrite_segment(part)
        for index, part in enumerate(parts)
    )


def rewrite_relative_links(text, source_path, output_path):
    """Rewrite links for a translated output path, excluding fenced code."""
    return _map_links(
        text,
        lambda target: _rewrite_relative_target(target, source_path, output_path),
    )


def unrewrite_relative_links(text, source_path, output_path):
    """Normalize output-relative links back to source-relative form.

    Reused blocks are read from the translated file and already point at the
    output directory; reversing them keeps the final rewrite idempotent.
    """
    return _map_links(
        text,
        lambda target: _unrewrite_relative_target(target, source_path, output_path),
    )


def rewrite_language_switch(text, target, source_path, output_path):
    """Make the translated README's language link point back to Chinese."""
    if target != "en":
        return text
    source_link = _rewrite_relative_target("README.md", source_path, output_path)
    return re.sub(
        r"(?m)^\*\*Languages:\*\*[^\n]*$",
        "**Languages:** [简体中文](%s)" % source_link,
        text,
        count=1,
    )


def _request(prompt, max_tokens, retries=3):
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "stream": False,
        # Hidden param: keeps reasoning OFF. Without it the model emits a long
        # chain-of-thought before the translation.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                API_BASE.rstrip("/") + "/chat/completions",
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Index-Translate-Client/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                res = json.loads(resp.read().decode("utf-8"))
            return strip_think(res["choices"][0]["message"]["content"])
        except (urllib.error.URLError, KeyError, json.JSONDecodeError) as e:
            last_err = e
            wait = 2 ** (attempt + 1)
            print("[chunk] attempt %d/%d failed (%s), retry in %ds" % (attempt + 1, retries, e, wait),
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("translation failed after %d attempts: %s" % (retries, last_err))


def translate_chunk(chunk, target, retries=3):
    return _request(build_prompt(chunk, target), max(2048, len(chunk) * 3), retries)


def translate_fence(fence, target, attempts=2):
    for _ in range(attempts):
        translated = _request(
            build_fence_prompt(fence, target), max(2048, len(fence) * 3)
        )
        if is_valid_fence(fence, translated):
            return translated
    raise RuntimeError("translation did not preserve the fenced block structure")


def _normalize_translation(text):
    """Keep one output block per input block so later runs can align blocks."""
    return re.sub(r"\n[ \t]*\n+", "\n", text).strip()


def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(state, dict) or state.get("schema") != STATE_SCHEMA:
        return None
    entries = state.get("items")
    if not isinstance(entries, list) or not all(
        isinstance(entry, dict) and "hash" in entry and "kind" in entry
        for entry in entries
    ):
        return None
    return state


def write_state(path, state):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")


def reuse_previous(items, previous_items, previous_state, source_path, output_path):
    """Map current content-item index -> existing translated text.

    The state records the previous run's source hashes; items are matched by
    hash so inserted, deleted, and reordered blocks keep the translations that
    still apply. Without a state file the existing translation is paired with
    the source by position, guarded by layout and anchor checks.
    """
    reuse = {}
    if not previous_items:
        return reuse

    if previous_state:
        previous_hashes = [entry["hash"] for entry in previous_state["items"]]
        previous_kinds = [entry["kind"] for entry in previous_state["items"]]
        if len(previous_hashes) != len(previous_items):
            log("state has %d items but the translation has %d; translating changed blocks from scratch"
                % (len(previous_hashes), len(previous_items)))
            return reuse
        # Match by source hash instead of position, so inserted, deleted, and
        # reordered items still reuse their existing translation.
        candidates = {}
        for index, key in enumerate(previous_hashes):
            candidates.setdefault(key, deque()).append(index)
        for index, item in enumerate(items):
            queue = candidates.get(item_hash(item))
            while queue:
                previous_index = queue.popleft()
                if previous_kinds[previous_index] == item["kind"]:
                    reuse[index] = previous_items[previous_index]["text"]
                    break
        return reuse

    # First run after the state file was introduced: pair the existing
    # translation with the source by position, but only if the whole document
    # layout matches and each pair's non-translatable anchors agree.
    if len(previous_items) != len(items):
        log("no state and the existing translation has %d items (source has %d); "
            "translating changed blocks from scratch" % (len(previous_items), len(items)))
        return reuse
    for current, previous in zip(items, previous_items):
        if current["kind"] != previous["kind"]:
            log("no state and the existing translation layout differs; translating changed blocks from scratch")
            return {}
        if current["kind"] == "block" and block_shape(current["text"]) != block_shape(previous["text"]):
            log("no state and the existing translation layout differs; translating changed blocks from scratch")
            return {}
    for index, (current, previous) in enumerate(zip(items, previous_items)):
        if not is_translatable(current):
            continue
        if current["kind"] == "fence":
            # Keep the existing translated comments only if the code itself is
            # unchanged; otherwise let the fence be translated again.
            if fence_skeleton(current["text"]) == fence_skeleton(previous["text"]):
                reuse[index] = previous["text"]
            continue
        if _same_anchors(current["text"], previous["text"], source_path, output_path):
            reuse[index] = previous["text"]
    log("seeded %d items from the existing translation" % len(reuse))
    return reuse


def is_translatable(item):
    return item["kind"] in ("block", "fence") and has_cjk(item["text"])


def translate_items(items, reuse, target, source_path, output_path):
    """Return content-item index -> output text for every translatable item."""
    translations = {}
    todo = [
        index for index, item in enumerate(items)
        if is_translatable(item) and index not in reuse
    ]
    reused = sum(
        1 for index, item in enumerate(items)
        if is_translatable(item) and index in reuse
    )
    log("reusing %d translated items, translating %d changed items" % (reused, len(todo)))
    for position, index in enumerate(todo, 1):
        item = items[index]
        if item["kind"] == "fence":
            log("[%d/%d] translating fenced block (%d chars)..." % (position, len(todo), len(item["text"])))
            translations[index] = translate_fence(item["text"], target)
        else:
            log("[%d/%d] translating %d chars..." % (position, len(todo), len(item["text"])))
            translations[index] = _normalize_translation(
                translate_chunk(item["text"], target)
            )
        if position < len(todo):
            time.sleep(0.5)  # be polite to the free endpoint
    for index in reuse:
        item = items[index]
        if not is_translatable(item):
            continue
        text = reuse[index]
        if item["kind"] == "block":
            # Reused text comes from the translated file, so its links are
            # already output-relative; normalize them before the final rewrite.
            text = unrewrite_relative_links(text, source_path, output_path)
        translations[index] = text
    return translations


def assemble(items, translations):
    parts = []
    position = 0
    for item in items:
        if item["kind"] == "sep":
            parts.append(item["text"])
            continue
        if position in translations:
            parts.append(translations[position])
        else:
            parts.append(item["text"])
        position += 1
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en", choices=sorted(LANG_NAMES))
    ap.add_argument("--preview", action="store_true",
                    help="translate only the first chunk and print it")
    ap.add_argument("--source", default=SOURCE)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    with open(args.source, encoding="utf-8") as f:
        text = f.read().replace("\r\n", "\n")

    if args.preview:
        chunks = split_chunks(text)
        print("source: %s (%d chars), %d chunks" % (args.source, len(text), len(chunks)),
              file=sys.stderr)
        print(translate_chunk(chunks[0], args.lang))
        return 0

    items = tokenize(text)
    content = content_items(items)
    log("source: %s (%d chars), %d items" % (args.source, len(text), len(content)))

    out = args.out or os.path.join("translations", args.lang, "README.md")
    out_dir = os.path.dirname(os.path.abspath(out))
    os.makedirs(out_dir, exist_ok=True)
    source_abs = os.path.abspath(args.source)
    out_abs = os.path.abspath(out)

    state_path = os.path.join(out_dir, STATE_FILE)
    state = load_state(state_path)
    if state is not None and (
        _portable(state.get("source", "")) != _portable(args.source)
        or state.get("lang") != args.lang
    ):
        log("state belongs to another source/language; ignoring it")
        state = None

    previous_items = []
    if os.path.exists(out_abs):
        with open(out_abs, encoding="utf-8") as f:
            previous_items = content_items(tokenize(f.read().replace("\r\n", "\n")))
    elif state is not None:
        log("previous translation is missing; translating every block")

    reuse = reuse_previous(items=content, previous_items=previous_items,
                           previous_state=state, source_path=source_abs,
                           output_path=out_abs)
    translations = translate_items(content, reuse, args.lang, source_abs, out_abs)

    translated_text = assemble(items, translations).rstrip() + "\n"
    translated_text = rewrite_relative_links(translated_text, source_abs, out_abs)
    translated_text = rewrite_language_switch(translated_text, args.lang, source_abs, out_abs)
    with open(out_abs, "w", encoding="utf-8", newline="\n") as f:
        f.write(translated_text)

    write_state(state_path, {
        "schema": STATE_SCHEMA,
        "source": _portable(args.source),
        "lang": args.lang,
        "output": _portable(out),
        "items": [
            {"kind": item["kind"], "hash": item_hash(item)} for item in content
        ],
    })
    log("wrote %s and %s" % (out, state_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
