# Codex Gateway

Backend NestJS trung gian giữa app của bạn và **Codex app-server**.

Frontend không bao giờ nói chuyện trực tiếp với Codex. Mọi thứ đi qua gateway này:
xác thực người dùng, phân tách dữ liệu giữa các user, và bọc kín giao thức JSON-RPC
của Codex.

> **Trạng thái: Phase 0 — Foundation.**
> Kiến trúc đầy đủ và thứ tự 8 phase nằm ở [`docs/codex-gateway-blueprint.md`](docs/codex-gateway-blueprint.md).

---

## Yêu cầu

- Node.js >= 20
- npm

Không cần cài `codex` toàn máy. Binary đi kèm `@openai/codex` được ghim trong
`package.json`, nên phiên bản Codex mà gateway chạy không thể bị `codex update`
ở đâu đó đổi ngầm.

## Cài đặt

```bash
npm install
```

Tạo `.env` từ mẫu:

```bash
cp .env.example .env
```

Sinh `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Sinh `ADMIN_PASSWORD_HASH` (mật khẩu gốc không được lưu ở đâu cả):

```bash
npm run auth:hash -- "mat-khau-cua-ban"
```

> **Windows:** đừng tạo `.env` bằng `Out-File -Encoding utf8` của PowerShell 5.1 —
> nó ghi kèm BOM, và BOM sẽ dính vào tên biến đầu tiên khiến dòng đó bị bỏ qua
> trong im lặng. Dùng `Set-Content -Encoding utf8NoBOM` hoặc soạn bằng editor.

## Chạy

```bash
npm run start:dev     # watch mode
npm run start:prod    # sau khi npm run build
```

---

## Hai tầng xác thực — không được nhầm

Đây là điểm dễ sai nhất của project.

| | Auth của app | Auth của Codex |
|---|---|---|
| Phạm vi | Từng user | **Toàn máy** |
| Cơ chế | JWT do gateway cấp | ChatGPT OAuth, lưu ở `~/.codex/auth.json` |
| Ai gọi được | Mọi user | **Chỉ admin** |
| Có ở phase | 0 | 2 |

Codex chỉ có **một identity duy nhất** cho cả host. Nghĩa là mọi user của gateway
dùng chung một tài khoản ChatGPT và chung hạn mức. Một user logout Codex sẽ logout
tất cả — nên từ Phase 2, các endpoint login/logout của Codex nằm sau `AdminGuard`.

## Endpoint hiện có

| Method | Path | Quyền |
|---|---|---|
| `POST` | `/api/auth/login` | công khai |
| `GET` | `/api/auth/me` | cần đăng nhập |
| `GET` | `/health` | công khai — liveness cho load balancer |
| `GET` | `/health/codex` | cần đăng nhập — phiên bản và đường dẫn binary |

Xác thực **bật mặc định**: `JwtAuthGuard` đăng ký toàn cục trong `app.module.ts`.
Route muốn mở phải khai báo `@Public()` — mỗi lần dùng decorator đó là một lỗ thủng
có chủ đích.

Thử nhanh:

```bash
curl -s localhost:3000/health

TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"mat-khau-cua-ban"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -s localhost:3000/health/codex -H "Authorization: Bearer $TOKEN"
```

---

## Scripts

| Lệnh | Việc |
|---|---|
| `npm run build` | Biên dịch sang `dist/` |
| `npm run lint` | ESLint (bỏ qua thư mục generated) |
| `npm run format` | Prettier |
| `npm test` | Jest |
| `npm run auth:hash -- "<pw>"` | Sinh bcrypt hash cho `ADMIN_PASSWORD_HASH` |
| `npm run codex:version` | Chạy binary Codex đã ghim |
| `npm run codex:protocol` | **Sinh lại** protocol bindings |

### Vì sao protocol bindings được commit

`src/codex/protocol/generated/` chứa 706 file TypeScript sinh bởi
`codex app-server generate-ts`. Chúng được commit có chủ đích: sau khi nâng phiên bản
Codex, **diff của thư mục đó chính là changelog protocol** chính xác nhất — không tài
liệu nào đáng tin bằng.

Không bao giờ sửa tay. Nâng version Codex trong `package.json` rồi chạy
`npm run codex:protocol` và đọc diff.

---

## Cấu trúc

```
src/
├── auth/          xác thực user của app (JWT) — Phase 3 đổi UserStore sang Mongo
├── codex/
│   ├── binary/    tìm executable Codex
│   └── protocol/  bindings generated — không sửa tay
├── common/        guards, decorators, exception filter
├── config/        env validation + config tree có kiểu
└── health/
```

Không nơi nào ngoài `src/config/` đọc `process.env`.

## Phase tiếp theo

**Phase 1 — Codex Client:** spawn `codex app-server` qua stdio, JSON-RPC hai chiều,
kèm khung xử lý `ServerRequest` ngay từ đầu. Approval của Codex là request
server → client mà app-server *chờ trả lời*; dựng client một chiều ở phase này đồng
nghĩa với việc phải viết lại toàn bộ ở Phase 5.
