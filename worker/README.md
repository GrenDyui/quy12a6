# Cloudflare Worker Proxy (Tuỳ chọn — Giấu Token 100% trên Server)

Miễn phí trọn đời (**100.000 lượt gọi / ngày**). Sau khi deploy xong, trình duyệt không bao giờ cần lưu GitHub Token nữa.

## Cách deploy không cần cài CLI (2 phút trên web)
1. Vào [dash.cloudflare.com](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Create Worker**.
2. Đặt tên `quy12a6-api` → bấm **Deploy** → bấm **Edit code**.
3. Dán toàn bộ nội dung file `worker/cloudflare-worker.js` vào rồi bấm **Deploy**.
4. Vào tab **Settings → Variables and Secrets**, thêm 3 **Secrets** (bật Encrypt):
   - `GITHUB_TOKEN`: Fine-Grained Token có quyền `Contents: Read and write` cho repo `GrenDyui/quy12a6`.
   - `ADMIN_PASSWORD`: Mật khẩu Thủ Quỹ của bạn (≥ 8 ký tự).
   - `SESSION_SECRET`: Chuỗi ngẫu nhiên bất kỳ (≥ 32 ký tự).
5. Copy link Worker dạng `https://quy12a6-api.<ten-ban>.workers.dev`:
   - Cách A: Dán vào web Sổ Quỹ → **🔄 Đồng bộ → Mục 4 (Cloudflare Worker Proxy)**.
   - Cách B (khuyên dùng): Dán thẳng vào `DEFAULT_REPO.workerUrl` trong file `js/config.js` rồi đẩy lên GitHub — từ đó mọi điện thoại/máy tính mở web đều tự trỏ thẳng vào Worker!
