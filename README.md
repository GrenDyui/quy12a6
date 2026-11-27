# 💰 Sổ Quỹ Lớp 12A6 (v3.0)

Cổng quản lý tài chính lớp 12A6 minh bạch, tốc độ cao, hoạt động trực tiếp trên **GitHub Pages** — không cần build step, cài đặt được như ứng dụng PWA trên điện thoại.

🔗 **Trang web chính thức:** https://grendyui.github.io/quy12a6/

---

## ✨ Nâng cấp nổi bật ở v3.0

### 1. Giải quyết triệt để vấn đề "phải add lại GitHub Token"
- **Két Token mã hóa AES-256-GCM (`vault.json`):** Nhập GitHub Token đúng **1 lần duy nhất**, đặt **Mật khẩu Két** (≥ 8 ký tự) → hệ thống mã hóa AES-256-GCM (PBKDF2-SHA256 600.000 vòng) và lưu ngay trong repo. Từ đó mở trên bất kỳ điện thoại hay máy tính nào chỉ cần nhập Mật khẩu Két để tự động mở khóa Thủ Quỹ & đồng bộ!
- **Lưu bền 2 lớp:** Kết hợp `IndexedDB` + `localStorage` + `navigator.storage.persist()`.
- **Ghép nối thiết bị trong 3 giây:** Tạo link ghép máy tự hết hạn sau 15 phút (mã hóa bằng mã 6 số dùng 1 lần).
- **Cloudflare Worker Proxy (Tuỳ chọn nâng cao):** Kèm sẵn `worker/cloudflare-worker.js` miễn phí để giấu Token 100% ở phía server.

### 2. Nâng cấp Hệ thống & Hiệu năng
- **Đọc dữ liệu không tốn GitHub API Rate Limit:** Bạn học & phụ huynh tải `data.json` và ảnh biên lai trực tiếp từ CDN (`./data.json` / `raw.githubusercontent.com`), tránh hoàn toàn lỗi HTTP 403 khi cả lớp mở chung Wi-Fi trường.
- **Gộp thay đổi thông minh (Smart Batching):** Gom nhiều thao tác thu tiền liên tiếp thành **1 commit sạch sẽ**, tự động thử lại khi gặp xung đột SHA (409/422), cảnh báo khi đóng tab lúc còn dữ liệu chưa lưu.
- **Thu hàng loạt & Thu hết nợ 1 chạm:** Chế độ **Chọn nhiều** để thu nhiều bạn cùng lúc; nút **Thu hết nợ** trong Hồ sơ & Bảng tổng hợp để gạch toàn bộ nợ lũy kế của 1 học sinh trong 1 chạm.
- **Lưu trữ lịch sử Khoản phụ (`extraHistory`):** Tạo đợt thu phụ mới không làm mất dữ liệu đợt cũ.
- **Tương thích 100% với Bot nhắc quỹ Zalo (`quy12a6-zalo-bot`):** Giữ nguyên toàn bộ cấu trúc chuẩn của `data.json`.

### 3. Giao diện Modern Editorial Treasury
- Gỡ bỏ hoàn toàn chi tiết trang trí rườm rà, tối ưu cho tốc độ tải tức thì (không phụ thuộc Tailwind CDN runtime).
- Hỗ trợ giao diện **Tối (Midnight Slate)** & **Sáng (Crisp Porcelain)** chuẩn CSS variables, chữ số tiền tệ căn thẳng cột (`JetBrains Mono` + `tabular-nums`).
- Toàn bộ hộp thoại nhập liệu dùng modal nội bộ mượt mà (tương thích tốt cả trong Zalo WebView).

---

## 📁 Cấu trúc Repo

```text
quy12a6/
├── index.html                   # Khung HTML chính & các modal
├── manifest.json                # Cấu hình PWA cài ra màn hình chính
├── sw.js                        # Service Worker hỗ trợ tải nhanh & offline
├── data.json                    # Dữ liệu quỹ lớp (tương thích Zalo Bot)
├── receipts/                    # Ảnh biên lai / hóa đơn thu chi
├── assets/                      # Biểu tượng vector 12A6
├── css/app.css                  # Hệ thống thiết kế CSS Variables (Dark/Light)
├── js/
│   ├── config.js                # Cấu hình, danh sách 45 học sinh, kiểm tra schema
│   ├── utils.js                 # Tiện ích tiền tệ, ngày tháng, copy, toast, confirm
│   ├── crypto-vault.js          # Mã hóa AES-256-GCM, IndexedDB, link ghép máy
│   ├── sync.js                  # Đồng bộ CDN/API/Worker, gộp commit, auto-retry
│   ├── render.js                # Render Dashboard, Sơ đồ lớp, Ma trận nợ, Biểu đồ
│   ├── actions.js               # VietQR, đối chiếu sao kê, xuất PNG & Excel
│   └── app.js                   # Khởi chạy ứng dụng & xử lý sự kiện
├── worker/                      # Cloudflare Worker Proxy tuỳ chọn
└── scripts/
    ├── publish_to_github.py     # Tool Python đẩy toàn bộ repo trong 1 commit (không cần git)
    └── DAY_LEN_GITHUB.bat       # Chạy nhanh bằng 1 click trên Windows
```

---

## 🚀 Cách đẩy bản nâng cấp lên GitHub (1 click, không cần cài Git)

Mở `scripts/DAY_LEN_GITHUB.bat` (hoặc chạy `python scripts/publish_to_github.py`), dán GitHub Token có quyền `Contents: Read and write` → script sẽ đẩy toàn bộ code lên nhánh `main` trong 1 commit duy nhất và **giữ nguyên `data.json` + `receipts/` đang chạy trên web**.
