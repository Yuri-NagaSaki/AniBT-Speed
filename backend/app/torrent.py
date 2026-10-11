"""Exact torrent identity from the original bencoded info span or a magnet URI."""

import base64
import hashlib
import re
from urllib.parse import parse_qs, urlsplit


def magnet_hash(url: str) -> str:
    values = parse_qs(urlsplit(url).query).get("xt", [])
    for value in values:
        if value.lower().startswith("urn:btih:"):
            token = value[9:]
            if re.fullmatch(r"[a-fA-F0-9]{40}", token):
                return token.lower()
            if re.fullmatch(r"[a-zA-Z2-7]{32}", token):
                return base64.b32decode(token.upper()).hex()
        if re.fullmatch(r"urn:btmh:1220[a-fA-F0-9]{64}", value):
            return value[13:53].lower()
    raise ValueError("Magnet has no supported torrent identity")


def torrent_identity(content: bytes) -> tuple[str, int]:
    """Return qB's primary hash and declared size. Bound depth and reject ambiguity."""
    info_span = None
    nodes = 0

    def decode(offset: int, depth: int = 0):
        nonlocal info_span, nodes
        nodes += 1
        if depth > 32 or nodes > 200000 or offset >= len(content):
            raise ValueError("Invalid torrent structure")
        token = content[offset : offset + 1]
        if token == b"i":
            end = content.index(b"e", offset)
            number = content[offset + 1 : end]
            if not re.fullmatch(rb"0|-?[1-9][0-9]*", number):
                raise ValueError("Invalid bencode integer")
            return int(number), end + 1
        if token in (b"d", b"l"):
            value = {} if token == b"d" else []
            offset += 1
            while content[offset : offset + 1] != b"e":
                if token == b"l":
                    item, offset = decode(offset, depth + 1)
                    value.append(item)
                else:
                    key, offset = decode(offset, depth + 1)
                    if not isinstance(key, bytes) or key in value:
                        raise ValueError("Invalid or duplicate dictionary key")
                    start = offset
                    item, offset = decode(offset, depth + 1)
                    value[key] = item
                    if depth == 0 and key == b"info":
                        info_span = content[start:offset]
            return value, offset + 1
        if token.isdigit():
            colon = content.index(b":", offset)
            raw_length = content[offset:colon]
            if not re.fullmatch(rb"0|[1-9][0-9]*", raw_length):
                raise ValueError("Invalid byte string length")
            length = int(raw_length)
            end = colon + 1 + length
            if end > len(content):
                raise ValueError("Truncated torrent")
            return content[colon + 1 : end], end
        raise ValueError("Invalid bencode token")

    try:
        root, end = decode(0)
        info = root[b"info"]
        if end != len(content) or not info_span or not isinstance(info, dict):
            raise ValueError("Invalid info dictionary")
        version_two = info.get(b"meta version") == 2
        digest = (
            hashlib.sha256(info_span).hexdigest()[:40]
            if version_two and b"pieces" not in info
            else hashlib.sha1(info_span).hexdigest()
        )

        def tree_size(tree):
            return sum(int(value.get(b"length", 0)) if key == b"" else tree_size(value) for key, value in tree.items())

        if b"files" in info:
            size = sum(int(file[b"length"]) for file in info[b"files"])
        elif b"length" in info:
            size = int(info[b"length"])
        elif version_two:
            size = tree_size(info[b"file tree"])
        else:
            raise ValueError("Torrent has no file lengths")
        if size < 0:
            raise ValueError("Negative torrent size")
        return digest, size
    except (KeyError, TypeError, IndexError, RecursionError, OverflowError) as error:
        raise ValueError("Invalid torrent metadata") from error
