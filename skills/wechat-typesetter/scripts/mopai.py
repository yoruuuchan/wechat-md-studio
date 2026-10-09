#!/usr/bin/env python3
"""mopai.py - agent client for 公众号排版助手 by Yoru (wechat-md-studio), a WeChat Markdown editor.

Talks to the REST door at `<base>/api/agent/*` with a Bearer token, so a coding
agent can push a Markdown draft into the web editor, hand the human a link, and
read the polished article back later. Typesetting itself happens in the browser;
this script does no rendering.

Subcommands:
  push          create an article, print its editor URL (local images are uploaded)
  update        rewrite an article, guarded by the content hash (optimistic lock)
  get           read one article; raw Markdown on stdout by default
  list          list articles (summaries only, no content)
  search        alias for `list --q TERM`
  themes        list the live theme table (never hardcoded)
  whoami        which token am I, and what may it do
  set-token     write MOPAI_TOKEN into the skill's .env
  token-status  show what the script actually read from .env (token masked)

There is no delete: removing an article stays a human action in the web UI.

Configuration comes from exactly one file, `<skill dir>/.env`, sitting next to
SKILL.md. The script deliberately does not read MOPAI_API_URL / MOPAI_TOKEN from
the environment: a skill's config belongs to the skill directory, so the same
token works no matter which shell or scheduler invokes it.

  MOPAI_API_URL   base URL, default https://wechat.yoru-and-akari.dev
  MOPAI_TOKEN     mopai_<base64url>; minted server-side via AGENT_TOKENS
  MOPAI_TIMEOUT   request timeout in seconds, default 60

Exit codes: 0 ok, 1 error, 2 usage error. Data commands print compact JSON on
stdout; `--pretty` adds a human rendering on stderr so stdout stays parseable.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path

DEFAULT_BASE_URL = "https://wechat.yoru-and-akari.dev"
DEFAULT_TIMEOUT = 60
TOKEN_PREFIX = "mopai_"

# Mirrors the server's MAX_IMAGE_BYTES (api/agent-router.ts). Checked locally so
# a 40MB screenshot costs a warning instead of a slow upload that is refused.
MAX_IMAGE_BYTES = 20 * 1024 * 1024

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}

# References that must be left alone. The rule is general: anything carrying a
# scheme is not a local file path, so there is nothing to upload.
#
# Two of these are this app's own. `img:<key>` is the short reference the web app
# expands to its stable image address, and `docx-import:N` is the placeholder a
# DOCX import leaves behind until that image has been uploaded. Note that neither
# has slashes, so a check written as `img://` (a very common way to do this)
# would miss them and try to upload a string that is not a path.
SKIP_PREFIXES = (
    "http://",
    "https://",
    "//",
    "data:",
    "img:",
    "local:",
    "docx-import:",
    "blob:",
    "mailto:",
)

# ![alt](path) or ![alt](<path with spaces>), optional "title". Groups are split
# so the replacement rebuilds the match exactly instead of doing a substring
# replace, which would hit the alt text whenever it repeats the path.
MD_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\(\s*)(<[^>]+>|[^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
HTML_IMAGE_RE = re.compile(r"(<img\b[^>]*?\bsrc=[\"'])([^\"']+)([\"'])", re.IGNORECASE)

SCRIPT_PATH = Path(__file__).resolve()
SKILL_ROOT = SCRIPT_PATH.parent.parent
ENV_FILE = SKILL_ROOT / ".env"
ENV_EXAMPLE = SKILL_ROOT / ".env.example"

ENV_FALLBACK_TEMPLATE = """# mopai skill config. The only config source for scripts/mopai.py.
# This file is gitignored; never commit a real token.

# ---- Connection -----------------------------------------------------------
MOPAI_API_URL=https://wechat.yoru-and-akari.dev

# Agent token, format mopai_<base64url>. See SKILL.md section 令牌.
# MOPAI_TOKEN=
"""


class MopaiError(Exception):
    """Anything that should end the run with a JSON error on stderr (exit 1)."""


class UsageError(MopaiError):
    """The command line itself was wrong (exit 2)."""


class ServerError(MopaiError):
    """The server answered with a non-2xx status and, usually, {error, hint}."""

    def __init__(self, status, error, hint=None, url=None, payload=None):
        super().__init__(error)
        self.status = status
        self.error = error
        self.hint = hint
        self.url = url
        self.payload = payload or {}


# ---- console encoding -------------------------------------------------------
#
# A cp936 Windows console raises UnicodeEncodeError on the first Chinese
# character, which would turn a successful push into a crash after the article
# is already on the server. Reconfigure to UTF-8, and make every write survive
# a console that still cannot encode what we hand it.
#
# newline="" matters just as much as the encoding. Text streams translate "\n"
# to "\r\n" on Windows, so `get > article.md` would hand back an article whose
# every line ending was rewritten — and pushing that file back would replace the
# stored text with a CRLF copy. stdin is included because it decodes with the
# console codepage by default, which mangles UTF-8 Markdown arriving through a
# pipe.


def force_utf8_stdio():
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace", newline="")
        except (AttributeError, OSError, ValueError):
            pass


def write_out(text, stream=None):
    stream = stream or sys.stdout
    try:
        stream.write(text)
        stream.flush()
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "ascii"
        try:
            stream.write(text.encode(encoding, errors="replace").decode(encoding, errors="replace"))
            stream.flush()
        except (OSError, UnicodeError):
            pass
    except OSError:
        pass  # closed pipe: nothing useful left to do


def emit_json(data, pretty=False, stream=None):
    if pretty:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    write_out(text + "\n", stream)


def emit_error(data):
    emit_json(data, stream=sys.stderr)


def emit_pretty(lines):
    if lines:
        write_out("\n".join(lines) + "\n", sys.stderr)


# ---- config (.env only) -----------------------------------------------------


def _unquote_env_value(raw):
    """Parse a .env value: strip wrapping quotes and a trailing ` # comment`.

    Single quotes are literal; double quotes understand \\n \\t \\" \\\\ the way a
    shell does. Tokens contain no spaces, so this granularity is enough.
    """
    raw = raw.strip()
    if not raw:
        return ""
    if raw[0] in ("'", '"'):
        quote = raw[0]
        out = []
        i = 1
        while i < len(raw):
            ch = raw[i]
            if ch == "\\" and quote == '"' and i + 1 < len(raw):
                nxt = raw[i + 1]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, "\\" + nxt))
                i += 2
                continue
            if ch == quote:
                break
            out.append(ch)
            i += 1
        return "".join(out)
    for i, ch in enumerate(raw):
        if ch == "#" and i > 0 and raw[i - 1].isspace():
            return raw[:i].rstrip()
    return raw


def parse_env_file(path):
    """Read KEY=VALUE lines, tolerating `export`, quotes and # comments.

    A missing or unreadable .env yields {} rather than an exception: the config
    file is a convenience, and the commands that need a token say so themselves.
    """
    result = {}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return result
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not key:
            continue
        result[key] = _unquote_env_value(value.strip())
    return result


_ENV_CACHE = None


def load_env():
    global _ENV_CACHE
    if _ENV_CACHE is None:
        _ENV_CACHE = parse_env_file(ENV_FILE)
    return _ENV_CACHE


def env_value(name):
    """Config lookup. Only source is the skill's .env; missing means empty."""
    return (load_env().get(name) or "").strip()


def mask_secret(value):
    """Enough to recognise which token it is, not enough to use it."""
    if not value:
        return None
    if len(value) <= 12:
        return f"****（共 {len(value)} 字符）"
    return f"{value[:10]}…{value[-4:]}（共 {len(value)} 字符）"


def relax_permissions(path):
    """Best-effort 0600. Meaningless on Windows, so failures are swallowed."""
    try:
        path.chmod(0o600)
    except (OSError, NotImplementedError, ValueError):
        pass


def ensure_env_file():
    """Create .env from .env.example when missing, so there is a file to edit."""
    if not ENV_FILE.is_file():
        ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            template = ENV_EXAMPLE.read_text(encoding="utf-8") if ENV_EXAMPLE.is_file() else None
        except (OSError, UnicodeDecodeError):
            template = None
        ENV_FILE.write_text(template or ENV_FALLBACK_TEMPLATE, encoding="utf-8")
    relax_permissions(ENV_FILE)
    return ENV_FILE


def write_env_value(key, value):
    """Set KEY=VALUE in .env in place; keep everything else byte for byte."""
    ensure_env_file()
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines()

    def key_of(line):
        stripped = line.strip()
        if stripped.startswith("export "):
            stripped = stripped[len("export "):].lstrip()
        return stripped.partition("=")[0].strip()

    for i, old in enumerate(lines):
        if not old.strip().startswith("#") and key_of(old) == key:
            lines[i] = f"{key}={value}"
            break
    else:
        # Prefer uncommenting the template's `# KEY=` line over appending a
        # second copy of the same key below it.
        for i, old in enumerate(lines):
            stripped = old.lstrip()
            if stripped.startswith("#") and key_of(stripped.lstrip("#")) == key:
                lines[i] = f"{key}={value}"
                break
        else:
            if lines and lines[-1].strip():
                lines.append("")
            lines.append(f"{key}={value}")

    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    relax_permissions(ENV_FILE)
    global _ENV_CACHE
    _ENV_CACHE = None
    return ENV_FILE


def invocation():
    """Copy-pasteable absolute command, so nobody has to guess where we live."""
    return f"python {SCRIPT_PATH}"


def base_url(args):
    raw = getattr(args, "base_url", None) or env_value("MOPAI_API_URL") or DEFAULT_BASE_URL
    return raw.rstrip("/")


def timeout_seconds(args):
    raw = getattr(args, "timeout", None) or env_value("MOPAI_TIMEOUT")
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT


def auth_headers():
    token = env_value("MOPAI_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}
    raise MopaiError(
        "缺少令牌：这个命令要带 Authorization: Bearer mopai_… 才能调用。"
        f"请在 {ENV_FILE} 里写 MOPAI_TOKEN=mopai_xxx，"
        f"或执行 {invocation()} set-token mopai_xxx。"
        "令牌在服务端 .env 的 AGENT_TOKENS=name:token 里配置，"
        "生成方法见 SKILL.md「令牌：报错后再看这一节」。"
    )


# ---- HTTP -------------------------------------------------------------------


def server_error(status, body_text, url):
    """Turn a response body into a ServerError, keeping the server's own hint."""
    data = None
    try:
        parsed = json.loads(body_text)
        if isinstance(parsed, dict):
            data = parsed
    except ValueError:
        pass

    if data is None:
        snippet = " ".join(body_text.split())[:200]
        message = f"HTTP {status}：返回的不是 JSON"
        if snippet:
            message += f"（{snippet}）"
        return ServerError(
            status,
            message,
            "多半是 Cloudflare Access 拦截页或反代错误页；/api/agent/* 需要在 Access 上按路径放行",
            url,
        )
    return ServerError(
        status,
        data.get("error") or f"HTTP {status}",
        data.get("hint"),
        url,
        data,
    )


def read_response(resp):
    raw = resp.read().decode("utf-8", errors="replace")
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise MopaiError(f"服务端返回的不是 JSON：{' '.join(raw.split())[:200]}")


def http_json(url, method="GET", payload=None, headers=None, args=None):
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req_headers["Content-Type"] = "application/json; charset=utf-8"

    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds(args)) as resp:
            return read_response(resp)
    except urllib.error.HTTPError as e:
        raise server_error(e.code, e.read().decode("utf-8", errors="replace"), url)
    except urllib.error.URLError as e:
        raise MopaiError(f"连不上 {url}：{e.reason}")
    except OSError as e:
        raise MopaiError(f"连不上 {url}：{e}")


def upload_image(base, image_path, headers, args=None):
    """POST one file to /api/agent/images; returns the server's JSON."""
    boundary = f"----mopai{uuid.uuid4().hex}"
    mime = MIME_BY_EXT.get(image_path.suffix.lower(), "application/octet-stream")
    body = b"\r\n".join([
        f"--{boundary}".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"'.encode("utf-8"),
        f"Content-Type: {mime}".encode(),
        b"",
        image_path.read_bytes(),
        f"--{boundary}--".encode(),
        b"",
    ])
    req_headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    req_headers.update(headers)

    url = f"{base}/api/agent/images"
    req = urllib.request.Request(url, data=body, method="POST", headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds(args)) as resp:
            return read_response(resp)
    except urllib.error.HTTPError as e:
        raise server_error(e.code, e.read().decode("utf-8", errors="replace"), url)
    except urllib.error.URLError as e:
        raise MopaiError(f"连不上 {url}：{e.reason}")
    except OSError as e:
        raise MopaiError(f"连不上 {url}：{e}")


# ---- local image references -------------------------------------------------


def is_remote_ref(ref):
    return ref.startswith(SKIP_PREFIXES)


def resolve_local_ref(ref, base_dir):
    """Resolve a Markdown image reference to a real local file, or None.

    Relative paths resolve against the Markdown file's own directory, not the
    cwd: the agent runs from the repo root, the article lives somewhere else.
    """
    cleaned = ref.strip()
    if cleaned.startswith("<") and cleaned.endswith(">"):
        cleaned = cleaned[1:-1]
    cleaned = urllib.parse.unquote(cleaned)
    if not cleaned:
        return None
    path = Path(cleaned).expanduser()
    if not path.is_absolute():
        path = base_dir / path
    try:
        path = path.resolve()
    except OSError:
        return None
    if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
        return path
    return None


def process_images(content, base_dir, base, headers, args=None):
    """Upload local images and rewrite their references to `img:<key>`.

    Returns (content, uploaded, warnings). One bad image never aborts the push:
    its original reference stays and the reason lands in `warnings`, because a
    draft with a broken picture is still worth handing to the human.
    """
    warnings = []
    cache = {}
    uploaded = 0

    def replacement_for(ref):
        nonlocal uploaded
        if is_remote_ref(ref):
            return None
        path = resolve_local_ref(ref, base_dir)
        if path is None:
            warnings.append(
                f"本地图片找不到或格式不支持，保留原引用：{ref}"
                f"（支持 {', '.join(sorted(IMAGE_EXTS))}，相对路径按 Markdown 所在目录解析）"
            )
            return None
        key = str(path)
        if key not in cache:
            try:
                size = path.stat().st_size
                if size > MAX_IMAGE_BYTES:
                    raise MopaiError(f"图片 {size // (1024 * 1024)}MB，超过 20MB 上限")
                if size == 0:
                    raise MopaiError("图片是空文件")
                result = upload_image(base, path, headers, args)
                # `ref` (img:<key>) is what belongs in the Markdown. The `url`
                # field is a convenience for humans: a raw absolute URL would not
                # survive WeChat re-hosting the image.
                ref_value = result.get("ref") or (f"img:{result['key']}" if result.get("key") else None)
                if not ref_value:
                    raise MopaiError("服务端没有返回 ref/key")
                cache[key] = ref_value
                uploaded += 1
            except (MopaiError, OSError) as e:
                message = getattr(e, "error", None) or str(e)
                warnings.append(f"图片上传失败，保留原引用：{ref}（{message}）")
                cache[key] = None
        return cache[key]

    def replace_md(match):
        prefix, ref, suffix = match.groups()
        new_ref = replacement_for(ref)
        if new_ref is None:
            return match.group(0)
        return prefix + new_ref + suffix

    def replace_html(match):
        prefix, ref, suffix = match.groups()
        new_ref = replacement_for(ref)
        if new_ref is None:
            return match.group(0)
        return prefix + new_ref + suffix

    content = MD_IMAGE_RE.sub(replace_md, content)
    content = HTML_IMAGE_RE.sub(replace_html, content)
    return content, uploaded, warnings


# ---- input ------------------------------------------------------------------


def read_content(args):
    """Content plus the directory its relative image paths resolve against."""
    text = getattr(args, "text", None)
    if text is not None:
        return text, Path.cwd()
    file_arg = getattr(args, "file", None)
    if file_arg:
        path = Path(file_arg).expanduser()
        if not path.is_file():
            raise UsageError(f"文件不存在：{path.resolve()}")
        try:
            # newline="": push the file's own line endings. read_text() would
            # translate CRLF to LF, and `get --out` writes bytes for exactly the
            # same reason — what comes back should be what went in.
            with path.open("r", encoding="utf-8", newline="") as fh:
                return fh.read(), path.parent.resolve()
        except UnicodeDecodeError:
            raise UsageError(f"文件不是 UTF-8 文本：{path.resolve()}")
    try:
        if not sys.stdin.isatty():
            return sys.stdin.read(), Path.cwd()
    except (OSError, ValueError):
        pass
    raise UsageError("缺少内容：用 --file、--text，或从 stdin 管道输入")


def doc_url(base, doc_id):
    return f"{base}/api/agent/docs/{urllib.parse.quote(doc_id, safe='')}"


def format_ts(ms):
    try:
        return datetime.fromtimestamp(int(ms) / 1000).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


# ---- commands ---------------------------------------------------------------


def cmd_push(args):
    base = base_url(args)
    content, base_dir = read_content(args)
    if not content.strip():
        raise UsageError("内容是空的，没什么可推的")

    # Fail before uploading anything: images and the article share one token.
    headers = auth_headers()
    content, uploaded, warnings = process_images(content, base_dir, base, headers, args)

    payload = {"content": content}
    if args.name:
        payload["name"] = args.name
    if args.source:
        payload["source"] = args.source

    data = http_json(f"{base}/api/agent/docs", method="POST", payload=payload,
                     headers=headers, args=args)
    out = {
        "ok": True,
        "id": data.get("id"),
        "name": data.get("name"),
        "editorUrl": data.get("editorUrl"),
        "hash": data.get("hash"),
        "savedAt": data.get("savedAt"),
        "source": data.get("source"),
        "uploadedImages": uploaded,
    }
    if warnings:
        out["warnings"] = warnings
    emit_json(out, getattr(args, "pretty", False))
    if getattr(args, "pretty", False):
        emit_pretty([
            f"已推送：《{out['name']}》",
            f"  id     {out['id']}",
            f"  hash   {out['hash']}",
            f"  图片   上传 {uploaded} 张" + (f"，{len(warnings)} 条警告" if warnings else ""),
            f"  给人看 {out['editorUrl']}",
        ])
    for line in warnings:
        write_out(f"warning: {line}\n", sys.stderr)
    if args.open and out.get("editorUrl"):
        webbrowser.open(out["editorUrl"])
    return 0


def cmd_update(args):
    base = base_url(args)
    content, base_dir = read_content(args)
    if not content.strip():
        raise UsageError("内容是空的：拒绝用它清空稿件")

    headers = auth_headers()
    content, uploaded, warnings = process_images(content, base_dir, base, headers, args)

    payload = {"content": content}
    if args.name:
        payload["name"] = args.name

    if args.force:
        # Explicit permission flag, not the absence of one: the server rejects
        # an update that carries neither a baseHash nor force, so "overwrite
        # whatever is there, including the human's edits in the browser" has to
        # be declared as such.
        base_hash = None
        payload["force"] = True
    elif args.base_hash:
        base_hash = args.base_hash
    else:
        current = http_json(doc_url(base, args.id), headers=headers, args=args)
        base_hash = current.get("hash")
    if base_hash:
        payload["baseHash"] = base_hash

    try:
        data = http_json(doc_url(base, args.id), method="PUT", payload=payload,
                         headers=headers, args=args)
    except ServerError as e:
        if e.status != 409:
            raise
        current = e.payload.get("current") or {}
        emit_json({
            "ok": False,
            "error": "conflict",
            "id": args.id,
            "current": current,
            "hint": "稿件在你上次读到之后被人改过了。先看 current.content 决定："
                    f"改完用 --base-hash {current.get('hash')} 重试，"
                    "或明确要覆盖时加 --force。",
        }, getattr(args, "pretty", False))
        if getattr(args, "pretty", False):
            emit_pretty([
                f"冲突：服务端现在是《{current.get('name')}》，"
                f"{format_ts(current.get('updatedAt'))} 改的，hash {current.get('hash')}",
                "  你推的版本没有写进去。",
            ])
        return 1

    out = {
        "ok": True,
        "id": data.get("id"),
        "name": data.get("name"),
        "updatedAt": data.get("updatedAt"),
        "hash": data.get("hash"),
        "baseHash": base_hash,
        "forced": bool(args.force),
        "uploadedImages": uploaded,
    }
    if warnings:
        out["warnings"] = warnings
    emit_json(out, getattr(args, "pretty", False))
    if getattr(args, "pretty", False):
        emit_pretty([
            f"已更新：《{out['name']}》 id {out['id']} hash {out['hash']}"
            + ("（--force 无条件覆盖）" if args.force else ""),
        ])
    for line in warnings:
        write_out(f"warning: {line}\n", sys.stderr)
    return 0


def meta_of(data):
    keys = ("id", "name", "chars", "hash", "createdAt", "updatedAt", "savedAt", "source")
    return {k: data.get(k) for k in keys}


def cmd_get(args):
    base = base_url(args)
    data = http_json(doc_url(base, args.id), headers=auth_headers(), args=args)
    content = data.get("content") or ""
    meta = meta_of(data)

    if args.out:
        out_path = Path(args.out).expanduser()
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            # Bytes, not write_text: no newline translation, exactly what the
            # server has, so the file can go straight back through `update`.
            out_path.write_bytes(content.encode("utf-8"))
        except OSError as e:
            raise MopaiError(f"写文件失败 {out_path.resolve()}：{e}")
        meta["out"] = str(out_path.resolve())
        emit_json(meta, getattr(args, "pretty", False))
        if getattr(args, "pretty", False):
            emit_pretty([f"《{meta['name']}》已写到 {meta['out']}",
                         f"  hash {meta['hash']}（回推时用作 --base-hash）"])
        return 0

    if args.meta:
        emit_json(meta, getattr(args, "pretty", False))
        return 0

    if not content.endswith("\n"):
        content += "\n"
    write_out(content)
    return 0


def fetch_list(args, q=None):
    base = base_url(args)
    params = {"limit": args.limit, "offset": args.offset}
    term = q if q is not None else args.q
    if term:
        params["q"] = term
    if args.saved:
        params["saved"] = "1"
    url = f"{base}/api/agent/docs?{urllib.parse.urlencode(params)}"
    return http_json(url, headers=auth_headers(), args=args)


def cmd_list(args):
    data = fetch_list(args)
    emit_json(data, getattr(args, "pretty", False))
    if getattr(args, "pretty", False):
        items = data.get("items") or []
        lines = [f"共 {data.get('total')} 篇，本页 {len(items)} 篇："]
        for item in items:
            saved = "已存草稿箱" if item.get("savedAt") else "未存草稿箱"
            lines.append(
                f"  {item.get('id')}  {item.get('chars'):>7} 字  {saved}  "
                f"{format_ts(item.get('updatedAt'))}  {item.get('source') or '浏览器创建'}  "
                f"《{item.get('name')}》"
            )
        emit_pretty(lines)
    return 0


def cmd_search(args):
    return cmd_list(args)


def cmd_themes(args):
    base = base_url(args)
    data = http_json(f"{base}/api/agent/themes", headers=auth_headers(), args=args)
    emit_json(data, getattr(args, "pretty", False))
    if getattr(args, "pretty", False) and isinstance(data, list):
        emit_pretty([f"{len(data)} 个主题："] + [
            f"  {t.get('id')}  [{t.get('category')}]  {t.get('name')} — {t.get('desc')}"
            for t in data if isinstance(t, dict)
        ])
    return 0


def cmd_whoami(args):
    base = base_url(args)
    data = http_json(f"{base}/api/agent/whoami", headers=auth_headers(), args=args)
    emit_json(data, getattr(args, "pretty", False))
    if getattr(args, "pretty", False):
        emit_pretty([
            f"令牌 {data.get('agent')}，权限 {'/'.join(data.get('scopes') or [])}",
            f"  服务端 {data.get('publicBaseUrl')}  时间 {format_ts(data.get('serverTime'))}",
        ])
    return 0


def cmd_set_token(args):
    """Write MOPAI_TOKEN into the skill's .env, for humans and agents alike."""
    if args.token is not None:
        raw = args.token
    else:
        try:
            raw = "" if sys.stdin.isatty() else sys.stdin.read()
        except (OSError, ValueError):
            raw = ""
    token = raw.strip().strip("'\"")
    if not token:
        raise UsageError(
            f"缺少令牌：{invocation()} set-token mopai_xxx，"
            f"或 echo 'mopai_xxx' | {invocation()} set-token（不留 shell 历史）"
        )

    write_env_value("MOPAI_TOKEN", token)
    out = {
        "ok": True,
        "envFile": str(ENV_FILE),
        "token": mask_secret(token),
        "apiUrl": base_url(args),
        "hint": f"已写入。用 {invocation()} whoami 验证令牌是否被服务端接受。",
    }
    if not token.startswith(TOKEN_PREFIX):
        out["warning"] = f"令牌一般以 {TOKEN_PREFIX} 开头，确认没有抄错或漏字符"
    emit_json(out, getattr(args, "pretty", False))
    return 0


def cmd_token_status(args):
    """Report what the script actually read, after something failed."""
    token = env_value("MOPAI_TOKEN")
    ready = bool(token)
    emit_json({
        "envFile": str(ENV_FILE),
        "envFileExists": ENV_FILE.is_file(),
        "apiUrl": base_url(args),
        "token": {
            "configured": ready,
            "value": mask_secret(token),
            "looksRight": token.startswith(TOKEN_PREFIX) if ready else False,
        },
        "ready": ready,
        "hint": (f"令牌已读到，用 {invocation()} whoami 确认服务端认不认"
                 if ready else
                 f"未配置令牌：在 {ENV_FILE} 里写 MOPAI_TOKEN=mopai_xxx，"
                 f"或执行 {invocation()} set-token mopai_xxx"),
    }, getattr(args, "pretty", False))
    return 0


def cmd_delete(args):
    raise UsageError(
        "没有 delete：agent 不能删稿件。删除是人在网页里做的动作"
        "（打开编辑器地址，左侧稿件列表里删），删掉之后 agent 也看不到、改不动它。"
    )


# ---- CLI --------------------------------------------------------------------


def build_parser():
    # Common flags live on a parent parser *and* on each subparser, so both
    # `mopai.py --pretty list` and `mopai.py list --pretty` work. SUPPRESS keeps
    # an unspecified subparser flag from overwriting the top-level value.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--base-url", default=argparse.SUPPRESS,
                        help=f"API 地址，默认取 .env 的 MOPAI_API_URL，再默认 {DEFAULT_BASE_URL}")
    common.add_argument("--timeout", default=argparse.SUPPRESS,
                        help=f"请求超时秒数，默认 {DEFAULT_TIMEOUT}")
    common.add_argument("--pretty", action="store_true", default=argparse.SUPPRESS,
                        help="stdout 仍是 JSON（缩进），另在 stderr 给人看的摘要")

    parser = argparse.ArgumentParser(
        prog="mopai.py",
        parents=[common],
        description="「公众号排版助手 by Yoru」的 agent 客户端：把 Markdown 推进网页编辑器，人工润色后再读回来。"
                    "零依赖，只用 Python 3 标准库。",
        epilog="配置只来自 <技能目录>/.env（MOPAI_API_URL / MOPAI_TOKEN）。"
               "直接跑命令就行，不用先检查 .env：缺令牌时错误信息里会带上路径和补救命令。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    p = sub.add_parser("push", parents=[common],
                       help="新建稿件，返回 editorUrl（本地图片自动上传）")
    p.add_argument("--file", help="本地 Markdown 文件；图片相对路径按它所在目录解析")
    p.add_argument("--text", help="直接给 Markdown 文本；\\n 不会被转义，长文本请用 --file 或 stdin")
    p.add_argument("--name", help="标题；省略时服务端从 front matter 或首个标题推导")
    p.add_argument("--source", help="来源标记，默认 agent:<令牌名>")
    p.add_argument("--open", action="store_true", help="推完用浏览器打开 editorUrl")
    p.set_defaults(func=cmd_push)

    p = sub.add_parser("update", parents=[common],
                       help="覆盖已有稿件，默认带 hash 锁（改过就 409）")
    p.add_argument("id", help="稿件 id")
    p.add_argument("--file", help="本地 Markdown 文件")
    p.add_argument("--text", help="直接给 Markdown 文本")
    p.add_argument("--name", help="同时改标题")
    p.add_argument("--base-hash", help="上次读到的 hash；不给就先读一次再写")
    p.add_argument("--force", action="store_true",
                   help="不带 baseHash，无条件覆盖（会盖掉人在浏览器里的修改）")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("get", parents=[common],
                       help="读一篇稿件；默认把 Markdown 原文打到 stdout")
    p.add_argument("id", help="稿件 id")
    p.add_argument("--out", help="把 Markdown 写到这个文件，stdout 改成打印元信息 JSON（含 hash）")
    p.add_argument("--meta", action="store_true", help="只要元信息 JSON（id/name/hash/时间），不要正文")
    p.set_defaults(func=cmd_get)

    p = sub.add_parser("list", parents=[common], help="列稿件摘要（不含正文）")
    p.add_argument("--q", help="搜索词，匹配标题和正文")
    p.add_argument("--limit", type=int, default=50, help="每页条数，默认 50，上限 200")
    p.add_argument("--offset", type=int, default=0, help="跳过前 N 条")
    p.add_argument("--saved", action="store_true", help="只看已存进草稿箱的")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("search", parents=[common], help="等价于 list --q TERM")
    p.add_argument("term", help="搜索词")
    p.add_argument("--limit", type=int, default=50, help="每页条数，默认 50")
    p.add_argument("--offset", type=int, default=0, help="跳过前 N 条")
    p.add_argument("--saved", action="store_true", help="只看已存进草稿箱的")
    p.set_defaults(func=cmd_search, q_from_term=True)

    p = sub.add_parser("themes", parents=[common], help="列线上主题表（实时拉取，不硬编码）")
    p.set_defaults(func=cmd_themes)

    p = sub.add_parser("whoami", parents=[common], help="当前令牌是谁、有什么权限")
    p.set_defaults(func=cmd_whoami)

    p = sub.add_parser("set-token", parents=[common], help="把令牌写进技能目录的 .env")
    p.add_argument("token", nargs="?", help="mopai_xxx；省略则从 stdin 读")
    p.set_defaults(func=cmd_set_token)

    p = sub.add_parser("token-status", parents=[common], help="显示 .env 读到了什么（令牌掩码）")
    p.set_defaults(func=cmd_token_status)

    p = sub.add_parser("delete", parents=[common], help="（没有这个能力）删除是网页里的人工动作")
    p.add_argument("id", nargs="?")
    p.set_defaults(func=cmd_delete)

    return parser


def error_payload(exc, status=None):
    payload = {"error": str(exc)}
    if isinstance(exc, ServerError):
        payload["status"] = exc.status
        payload["url"] = exc.url
        if exc.hint:
            payload["hint"] = exc.hint
    if status:
        payload["status"] = status
    payload["script"] = str(SCRIPT_PATH)
    payload["envFile"] = str(ENV_FILE)
    return payload


def main(argv=None):
    force_utf8_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)

    func = getattr(args, "func", None)
    if func is None:
        parser.print_help()
        return 2

    # `search TERM` is `list --q TERM`; fold the positional into the shared code.
    if getattr(args, "q_from_term", False):
        args.q = args.term

    try:
        return func(args) or 0
    except UsageError as e:
        emit_error(error_payload(e, status=2))
        return 2
    except ServerError as e:
        emit_error(error_payload(e))
        return 1
    except MopaiError as e:
        emit_error(error_payload(e))
        return 1
    except KeyboardInterrupt:
        emit_error({"error": "被中断", "script": str(SCRIPT_PATH)})
        return 1
    except Exception as e:  # keep tracebacks off the agent's stdout/stderr
        emit_error({
            "error": f"{type(e).__name__}: {e}",
            "hint": "这不是服务端返回的错误，是脚本自己出问题了；把上面这行连同命令一起报给维护者",
            "script": str(SCRIPT_PATH),
            "envFile": str(ENV_FILE),
        })
        return 1


if __name__ == "__main__":
    sys.exit(main())
