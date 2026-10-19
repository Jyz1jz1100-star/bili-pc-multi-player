#!/usr/bin/env python3
"""Minimal asar pack/unpack (read + write) without external deps."""
import json, os, struct, sys

def read_header(fh):
    fh.seek(0)
    first = fh.read(8)
    assert len(first) == 8, "file too small"
    payload_size, header_size = struct.unpack("<II", first)
    assert payload_size == 4, f"unexpected pickle size {payload_size}"
    fh.seek(8)
    hdr = fh.read(header_size)
    assert len(hdr) == header_size
    plen, slen = struct.unpack("<II", hdr[:8])
    raw = hdr[8:8 + slen]
    header = json.loads(raw.decode("utf-8"))
    return header, header_size

def unpack(asar_path, out_dir):
    with open(asar_path, "rb") as fh:
        header, header_size = read_header(fh)
        data_offset = 8 + header_size
        count = 0
        for rel, node in walk(header["files"]):
            target = os.path.join(out_dir, rel.replace("/", os.sep))
            if node.get("unpacked"):
                continue
            if "link" in node:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            fh.seek(data_offset + int(node["offset"]))
            data = fh.read(int(node["size"]))
            with open(target, "wb") as out:
                out.write(data)
            count += 1
    return count

def walk(tree, prefix=""):
    for name, node in tree.items():
        rel = f"{prefix}/{name}" if prefix else name
        if "files" in node:
            yield from walk(node["files"], rel)
        else:
            yield rel, node

def build_tree(src_dir):
    tree = {"files": {}}
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        rel_root = os.path.relpath(root, src_dir)
        parts = [] if rel_root == "." else rel_root.split(os.sep)
        node = tree
        for p in parts:
            node = node["files"].setdefault(p, {"files": {}})
        for f in sorted(files):
            full = os.path.join(root, f)
            st = os.stat(full)
            node["files"][f] = {"size": st.st_size, "offset": "0"}
    return tree

def pack(src_dir, out_asar):
    # first compute sizes/offsets
    entries = []
    def collect(tree, prefix=""):
        for name, node in tree["files"].items():
            rel = f"{prefix}/{name}" if prefix else name
            if "files" in node:
                collect(node, rel)
            else:
                entries.append((rel, node))
    collect(tree := build_tree(src_dir))
    data = bytearray()
    for rel, node in entries:
        node["offset"] = str(len(data))
        with open(os.path.join(src_dir, rel.replace("/", os.sep)), "rb") as f:
            data += f.read()
    header_json = json.dumps(tree, separators=(",", ":")).encode("utf-8")
    # header string is not 4-byte aligned requirement; electron accepts unaligned
    header_payload = struct.pack("<I", len(header_json)) + header_json
    header_pickle = struct.pack("<I", len(header_payload)) + header_payload
    size_pickle = struct.pack("<II", 4, len(header_pickle))
    with open(out_asar, "wb") as out:
        out.write(size_pickle)
        out.write(header_pickle)
        out.write(data)

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "unpack":
        print(unpack(sys.argv[2], sys.argv[3]))
    elif cmd == "pack":
        pack(sys.argv[2], sys.argv[3])
        print("packed", os.path.getsize(sys.argv[3]))
    elif cmd == "list":
        with open(sys.argv[2], "rb") as fh:
            header, hs = read_header(fh)
        for rel, node in walk(header["files"]):
            print(node.get("size", 0), rel)
