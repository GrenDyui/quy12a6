#!/usr/bin/env python3
"""
1-Click GitHub Publisher for GrenDyui/quy12a6 (Zero dependencies, no git CLI required!)
--------------------------------------------------------------------------------------
Đẩy toàn bộ mã nguồn nâng cấp lên GitHub trong DUY NHẤT 1 commit nguyên tử (Git Data API).
MẶC ĐỊNH GIỮ NGUYÊN `data.json`, `vault.json` và `receipts/` đang có trên GitHub
để tuyệt đối không ghi đè dữ liệu thu quỹ thực tế của lớp!

Cách chạy:
    python scripts/publish_to_github.py
    # Hoặc truyền token qua biến môi trường:
    set GITHUB_TOKEN=ghp_xxx && python scripts/publish_to_github.py
"""

import argparse
import base64
import getpass
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OWNER = "GrenDyui"
DEFAULT_REPO = "quy12a6"
DEFAULT_BRANCH = "main"

# Các file dữ liệu live trên GitHub được bảo vệ mặc định (không ghi đè)
PROTECTED_FILES = {"data.json", "vault.json"}
PROTECTED_PREFIXES = ("receipts/",)

IGNORE_NAMES = {
    ".git", ".env", ".env.local", ".github_token", "__pycache__",
    "node_modules", ".wrangler", ".DS_Store", "Thumbs.db"
}
IGNORE_SUFFIXES = (".pyc", ".bak")


def api_req(method: str, url: str, token: str, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "quy12a6-publisher/3.0",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub HTTP {e.code} tại {url}: {detail[:300]}") from e


def collect_local_files(include_data: bool) -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        parts = rel.split("/")
        if any(p in IGNORE_NAMES for p in parts):
            continue
        if rel.endswith(IGNORE_SUFFIXES):
            continue
        if not include_data:
            if rel in PROTECTED_FILES or any(rel.startswith(pfx) for pfx in PROTECTED_PREFIXES):
                continue
        files.append((rel, path.read_bytes()))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="Đẩy bản nâng cấp Sổ Quỹ 12A6 lên GitHub (1 atomic commit)")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--message", default="Upgrade Sổ Quỹ 12A6 v3.0: Modern Fintech UI + Encrypted Token Vault + Worker Proxy")
    parser.add_argument("--include-data", action="store_true", help="Ghi đè cả data.json (MẶC ĐỊNH TẮT để bảo toàn dữ liệu live)")
    parser.add_argument("--vault-password", default=os.environ.get("VAULT_PASSWORD", ""), help="Mật khẩu Két Token (>= 8 ký tự) để tự tạo vault.json mã hóa AES-256")
    parser.add_argument("--vault-hint", default=os.environ.get("VAULT_HINT", ""), help="Gợi ý mật khẩu Két (tuỳ chọn)")
    parser.add_argument("--skip-vault", action="store_true", help="Bỏ qua bước tạo Két Token vault.json")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print(f"=== Cài đặt & Đẩy Sổ Quỹ 12A6 v3.0 lên {args.owner}/{args.repo} ({args.branch}) ===")
        print("Mẹo: Dán GitHub Personal Access Token (quyền Contents: Read and write).")
        token = getpass.getpass("1) Nhập GitHub Token (ẩn ký tự khi gõ): ").strip()
    if not token:
        print("❌ Chưa nhập token, hủy thao tác.")
        return 1

    vault_bytes = None
    if not args.skip_vault:
        vault_pw = args.vault_password.strip()
        vault_hint = args.vault_hint.strip()
        if not vault_pw and sys.stdin.isatty():
            print("\n2) Tạo Két Token mã hóa AES-256 (vault.json) để KHÔNG BAO GIỜ phải nhập lại Token:")
            print("   (Bỏ trống và bấm Enter nếu bạn muốn bỏ qua bước này)")
            while True:
                p1 = getpass.getpass("   Đặt Mật khẩu Két (>= 8 ký tự): ").strip()
                if not p1:
                    break
                if len(p1) < 8:
                    print("   ⚠️  Mật khẩu quá ngắn, cần tối thiểu 8 ký tự!")
                    continue
                p2 = getpass.getpass("   Nhập lại Mật khẩu Két: ").strip()
                if p1 != p2:
                    print("   ⚠️  Mật khẩu nhập lại không khớp, thử lại!")
                    continue
                vault_pw = p1
                vault_hint = input("   Gợi ý mật khẩu (tuỳ chọn, Enter để bỏ qua): ").strip()
                break
        if vault_pw:
            if len(vault_pw) < 8:
                print("❌ Mật khẩu Két phải tối thiểu 8 ký tự.")
                return 1
            print("   🔐 Đang mã hóa GitHub Token bằng AES-256-GCM (PBKDF2 600.000 vòng)...")
            payload = json.dumps({
                "token": token,
                "password": vault_pw,
                "owner": args.owner,
                "repo": args.repo,
                "hint": vault_hint,
                "unlockAdmin": True,
            })
            proc = subprocess.run(
                ["node", str(ROOT / "scripts" / "setup_vault.mjs")],
                input=payload,
                text=True,
                capture_output=True,
                encoding="utf-8",
                check=True,
            )
            vault_bytes = proc.stdout.encode("utf-8")
            print("   ✅ Đã tạo vault.json mã hóa an toàn!")

    base = f"https://api.github.com/repos/{args.owner}/{args.repo}"
    print(f"\n1/5 Kiểm tra nhánh {args.branch} trên {args.owner}/{args.repo}...")
    ref = api_req("GET", f"{base}/git/ref/heads/{args.branch}", token)
    head_sha = ref["object"]["sha"]
    head_commit = api_req("GET", f"{base}/git/commits/{head_sha}", token)
    base_tree_sha = head_commit["tree"]["sha"]
    print(f"    Commit hiện tại: {head_sha[:7]}")

    local_files = collect_local_files(include_data=args.include_data)
    if vault_bytes is not None:
        local_files.append(("vault.json", vault_bytes))
    print(f"2/5 Chuẩn bị {len(local_files)} tệp nguồn (giữ nguyên data.json & receipts/ trên GitHub)...")

    tree_entries = []
    for idx, (rel, content) in enumerate(local_files, 1):
        b64 = base64.b64encode(content).decode("ascii")
        blob = api_req("POST", f"{base}/git/blobs", token, {"content": b64, "encoding": "base64"})
        tree_entries.append({
            "path": rel,
            "mode": "100644",
            "type": "blob",
            "sha": blob["sha"],
        })
        print(f"    [{idx}/{len(local_files)}] Đã tải lên: {rel} ({len(content):,} bytes)")

    print("3/5 Tạo Git tree mới (kế thừa data.json & receipts/ hiện có)...")
    new_tree = api_req("POST", f"{base}/git/trees", token, {
        "base_tree": base_tree_sha,
        "tree": tree_entries,
    })

    print("4/5 Tạo commit mới...")
    new_commit = api_req("POST", f"{base}/git/commits", token, {
        "message": args.message,
        "tree": new_tree["sha"],
        "parents": [head_sha],
    })

    print(f"5/5 Cập nhật nhánh {args.branch}...")
    api_req("PATCH", f"{base}/git/refs/heads/{args.branch}", token, {
        "sha": new_commit["sha"],
        "force": False,
    })

    print("\n✅ ĐẨY CODE THÀNH CÔNG!")
    print(f"   Commit: {new_commit['sha'][:7]}")
    print(f"   Web   : https://{args.owner.lower()}.github.io/{args.repo}/ (chờ ~30-60s để GitHub Pages cập nhật)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"\n❌ LỖI: {exc}")
        sys.exit(1)
