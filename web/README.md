# Codex Gateway — giao diện web

Console cho agent Codex chạy sau gateway. Next.js App Router, TypeScript, CSS thuần.

```bash
npm install
npm run dev     # http://localhost:3001
```

Cần gateway đang chạy ở cổng 3000, và cổng 3001 phải nằm trong `CORS_ORIGINS` của
gateway — đó là lý do `dev` ghim sẵn `-p 3001`.

## Nó làm được gì

| | |
|---|---|
| Đăng nhập | token lưu ở `localStorage`, xác thực lại với gateway mỗi lần tải trang |
| Project | tạo project trỏ vào thư mục trong allowlist; lỗi từ gateway hiện nguyên văn |
| Hội thoại | tạo, chọn, xoá; tự đặt tên theo tin nhắn đầu tiên |
| Chat | stream từng token qua WebSocket, có con trỏ nhấp nháy |
| Dừng giữa chừng | nút **Dừng** khi đang chạy; phần đã stream vẫn được giữ |
| Approval | hiện lệnh sắp chạy + lý do, ba lựa chọn: cho phép / cả phiên / từ chối |
| Hoạt động | lệnh đã chạy, file đã sửa — kiểu IDE |
| Hạn mức | thanh đo dùng chung, cập nhật realtime |
| Tài khoản Codex | **chỉ admin** — xem tài khoản đang dùng, lấy link đổi sang tài khoản khác |

## Đổi tài khoản Codex

Chip email ở thanh trên **chỉ hiện với admin**. Bấm vào mở panel:

1. Bấm **Lấy link đăng nhập** → link hiện ra trong ô, kèm nút *Mở trong tab mới* và *Sao chép link*.
2. Đăng nhập bằng tài khoản ChatGPT muốn chuyển sang.
3. Panel tự cập nhật khi xong — nó poll trạng thái 3 giây một lần trong lúc chờ.

**Không cần đăng xuất trước.** Đã kiểm chứng: xin được link ngay khi đang đăng nhập, và
huỷ thì tài khoản cũ nguyên vẹn. Nhờ vậy gateway vẫn dùng được trong lúc chờ ai đó hoàn
tất việc đổi.

Nút **mã thiết bị** dành cho khi bạn không ngồi ở máy chạy gateway: luồng trình duyệt hoàn
tất qua `localhost:1455` của *máy đó*, nên ở xa sẽ không chạy được.

Codex chỉ giữ **một** tài khoản cho cả máy — đây là đổi cho mọi người, không phải cài đặt
riêng từng user. Thread đã có vẫn còn (chúng nằm theo `CODEX_HOME`, không theo tài khoản),
nhưng từ đó trở đi mọi lượt chat tính vào hạn mức của tài khoản mới.

## Vài quyết định

**Một kênh sự kiện.** Tất cả đi qua `codex.event` với `method` giữ nguyên tên protocol
của Codex; sự kiện của riêng gateway mang tiền tố `gateway/`. Client `switch` theo
`method`. Dựng một bộ tên song song chỉ tạo thêm một lớp dịch phải bảo trì.

**Approval phải ghép với item.** Payload của `item/fileChange/requestApproval` **không
chứa đường dẫn file** — chỉ có `itemId`. Nội dung nằm ở item `commandExecution` vừa
`item/started` ngay trước đó. Thẻ approval tra ngược theo `itemId`, vì bắt người ta duyệt
một ô trống là điều tệ nhất giao diện này có thể làm.

**Delta không ghi đè bản lưu.** Khi `item/completed` tới, con trỏ dừng và lịch sử được
tải lại từ gateway — bản lưu mới là bản đúng.

**Feed hoạt động không bị xoá khi turn kết thúc.** Chỉ xoá khi chuyển hội thoại hoặc bắt
đầu lượt mới. Xoá lúc kết thúc là mất luôn dấu vết agent vừa làm gì.

**Token trong `localStorage`.** Đủ cho công cụ chạy localhost. Nếu đưa ra mạng thật thì
nên chuyển sang cookie `httpOnly`, và việc đó cần gateway đổi cách phát token.

## Kiểm chứng

Toàn bộ luồng đã chạy thật trong Chrome headless (`puppeteer-core`) đối chiếu với gateway
và Codex thật: đăng nhập → tạo hội thoại → gửi tin → **bắt được lúc đang stream** → duyệt
approval → lệnh chạy → file được tạo. Không có lỗi console.
