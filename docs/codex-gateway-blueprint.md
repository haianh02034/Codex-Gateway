# Codex Gateway Blueprint

> **Architecture locked · Codex 0.153.4**

Backend NestJS trung gian giữa app và Codex. Bản này chốt kiến trúc, ranh giới bảo mật và thứ tự triển khai — mọi contract dưới đây đã đối chiếu với protocol binding sinh từ chính binary, không phải từ tài liệu.

| | |
|---|---|
| **Transport** | app-server JSON-RPC |
| **Tenancy** | multi-user, quota dùng chung |
| **Store** | MongoDB từ Phase 3 |
| **Phase** | 0 → 7 |

---

## Mục lục

- [A. Bốn quyết định đã chốt](#a-bốn-quyết-định-đã-chốt)
- [B. Môi trường đã kiểm chứng](#b-môi-trường-đã-kiểm-chứng)
- [C. Vì sao không dùng SDK](#c-vì-sao-không-dùng-sdk)
- [D. Ranh giới tin cậy](#d-ranh-giới-tin-cậy)
- [E. Protocol reference](#e-protocol-reference)
- [F. Bảo mật bắt buộc](#f-bảo-mật-bắt-buộc)
- [G. MongoDB](#g-mongodb)
- [Thứ tự triển khai (Phase 0 → 7)](#thứ-tự-triển-khai-phase-0--7)

---

## A. Bốn quyết định đã chốt

Mỗi quyết định dưới đây thay thế một phương án trong plan gốc. Lý do nằm ở các mục sau.

### Transport — Codex app-server, từ Phase 1
Không dùng Python bridge, cũng không dùng `@openai/codex-sdk`. SDK không có API auth, không có approval, không có token delta.

### Tenancy — Multi-user trên một identity Codex
Mọi user dùng chung một tài khoản ChatGPT và chung hạn mức. Kéo theo toàn bộ mục Bảo mật.

### Persistence — MongoDB có mặt từ Phase 3
Mongo là lớp ACL duy nhất phân tách user, nên không thể để sau — nó là điều kiện của multi-user.

### Thứ tự — Client trước, Auth sau
Auth là một JSON-RPC call trên app-server. Không thể có auth trước khi có lớp client.

---

## B. Môi trường đã kiểm chứng

Chạy trực tiếp trên binary `codex.exe` 0.153.4, không suy đoán từ tài liệu.

| Hạng mục | Kết quả |
|---|---|
| `codex` CLI | **Chưa cài** trên máy dev — không có trong PATH, không có `~/.codex`. Đây là việc đầu tiên của Phase 0. |
| `@openai/codex` | 0.153.4 · binary theo platform qua `optionalDependencies` |
| `@openai/codex-sdk` | 0.153.4 · SDK TypeScript chính thức *đã tồn tại* — nhưng không dùng, xem mục kế |
| Transport khả dụng | `stdio://` (mặc định) · `unix://` · `ws://IP:PORT` |
| WebSocket auth | `capability-token` hoặc `signed-bearer-token` — chỉ bắt buộc với listener **non-loopback** |
| Protocol binding | `app-server generate-ts` sinh **706 file .ts** (92 gốc + 613 trong `v2/`) |
| Thread storage | `~/.codex/sessions` — trên đĩa local của máy chạy Codex |

> **Nguyên tắc** — Không viết tay type cho protocol. Commit output của `generate-ts` vào repo và regenerate mỗi lần bump version Codex — diff của thư mục đó chính là changelog protocol.

---

## C. Vì sao không dùng SDK

`@openai/codex-sdk` chỉ bọc `codex exec --experimental-json`: một chiều, không tương tác. Ba trong bảy phase không thể xây trên nó.

| Năng lực cần có | codex-sdk | app-server |
|---|---|---|
| Auth / login flow | ❌ Không có — `CodexOptions` chỉ nhận sẵn `apiKey` | ✅ `account/login/start` |
| Approval | ❌ Không có — union `ThreadEvent` không có event approval, không có callback | ✅ 3 loại request |
| Token delta | ❌ Không có — chỉ `item.started / updated / completed` | ✅ `item/agentMessage/delta` |
| Interrupt | ⚠️ Chỉ AbortSignal — giết cả turn | ✅ `turn/interrupt` |
| Steer giữa turn | ❌ Không có | ✅ `turn/steer` |
| Rate limit hiện tại | ❌ Không có | ✅ `account/rateLimits/read` |
| Resume thread | ✅ Có | ✅ Có |

> **⚠️ Bẫy kiến trúc**
>
> Approval là **server → client JSON-RPC request**, không phải notification — app-server *block chờ* response. Nghĩa là lớp Codex Client phải bidirectional **ngay từ Phase 1**. Nếu Phase 1 xây một event emitter một chiều thì đến Phase 5 phải viết lại toàn bộ lớp client.
>
> Hệ quả thực hành: Phase 1 cài sẵn khung xử lý `ServerRequest` kể cả khi chưa có UI approval — cứ trả `{"denied":{"rejection":"chưa hỗ trợ"}}` cho tới Phase 5.

---

## D. Ranh giới tin cậy

Điểm quan trọng nhất của multi-user: app-server không biết gì về user. Threads là global theo máy. Mongo là thứ duy nhất phân tách người dùng.

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js — user A, B, C                                       │
│ Mỗi user một phiên, một JWT riêng                            │
└──────────────────────────────────────────────────────────────┘
                    │  HTTPS / WSS · JWT
┌──────────────────────────────────────────────────────────────┐
│ NestJS · AuthGuard + AdminGuard                              │
│ Xác thực user của app. Hoàn toàn tách khỏi auth của Codex.   │
└──────────────────────────────────────────────────────────────┘
                    │  userId
╔══════════════════════════════════════════════════════════════╗
║ MongoDB — RANH GIỚI PHÂN TÁCH DUY NHẤT                       ║
║ userId → projectId → codexThreadId.                          ║
║ Mọi request phải đi qua đây.                                 ║
║ Không có lớp nào phía dưới biết user là ai.                  ║
╚══════════════════════════════════════════════════════════════╝
                    │  codexThreadId đã verify
┌──────────────────────────────────────────────────────────────┐
│ Codex Client · JSON-RPC 2 chiều                              │
│ Request ra, ServerRequest vào. Encapsulate hoàn toàn.        │
└──────────────────────────────────────────────────────────────┘
                    │  stdio (loopback)
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  Codex app-server — DÙNG CHUNG
  Một identity, một quota, threads global, ~/.codex/sessions
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                    │  HTTPS
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  OpenAI — thấy tất cả như một tài khoản duy nhất
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

> **🔴 BẮT BUỘC**
>
> **Không bao giờ proxy `thread/list` ra API.** `ThreadListParams` chỉ filter được `cwd`, `archived`, `sourceKinds`, `searchTerm` — *không có owner*. Gọi thẳng sẽ trả về thread của mọi user.
>
> Luồng đúng: query Mongo theo `userId` → lấy danh sách `codexThreadId` đã verify → mới gọi Codex theo từng id. Áp dụng y hệt cho `thread/read`, `thread/items/list`, `thread/delete`, `thread/fork`.

---

## E. Protocol reference

Trích từ binding đã generate. Đây là phần sẽ tra nhiều nhất lúc code.

### Auth — client → server

| Method | Ghi chú |
|---|---|
| `account/login/start` | Trả `authUrl` cho ChatGPT OAuth, hoặc `verificationUrl` + `userCode` cho device code |
| `account/login/cancel` | Huỷ login đang chờ theo `loginId` |
| `account/logout` | **Ảnh hưởng toàn hệ thống** — admin only |
| `getAuthStatus` | Trả về cả `authToken` — phải lọc, xem mục Bảo mật |
| `account/rateLimits/read` | Hạn mức dùng chung hiện tại |

Contract của login ChatGPT map 1:1 với API thiết kế ban đầu:

```ts
// LoginAccountResponse — biến thể chatgpt
{ type: "chatgpt", loginId: string, authUrl: string }

// LoginAccountResponse — biến thể chatgptDeviceCode
{ type: "chatgptDeviceCode", loginId: string,
  verificationUrl: string, userCode: string }

// notification account/login/completed — push, KHÔNG cần polling
{ loginId: string | null, success: boolean, error: string | null }
```

### Thread & turn

| Method | Ghi chú |
|---|---|
| `thread/start` | Trả `ThreadStartResponse.thread` **ngay lập tức** — nên `codexThreadId` không cần nullable |
| `thread/resume` | Mở lại thread cũ theo id |
| `turn/start` | Gửi message, mở một turn |
| `turn/interrupt` | Cần `{ threadId, turnId }` — **phải lưu turnId** |
| `turn/steer` | Chèn message vào turn *đang chạy* |
| `thread/fork` | Nhánh hội thoại từ một điểm |
| `thread/compact/start` | Nén context khi thread dài |

### Streaming — server → client notification

| Notification | Dùng để |
|---|---|
| `item/agentMessage/delta` | Text theo token: `{ threadId, turnId, itemId, delta }` |
| `item/reasoning/textDelta` | Reasoning stream |
| `item/commandExecution/outputDelta` | stdout/stderr realtime của lệnh |
| `item/plan/delta` | To-do list của agent |
| `item/started` · `item/completed` | Vòng đời item — **đây là thứ cần persist** |
| `turn/completed` | Kết thúc turn, kèm token usage |
| `account/rateLimits/updated` | Broadcast quota cho mọi user |
| `serverRequest/resolved` | Approval đã được giải quyết ở nơi khác |

### Approval — server → client request

App-server chờ response cho các request này. Route theo owner của thread, kèm timeout.

```
// ServerRequest cần xử lý
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/permissions/requestApproval
item/tool/requestUserInput

// ReviewDecision — phong phú hơn allow/reject
"approved"
"approved_for_session"
{ denied: { rejection: string } }
"abort"
"timed_out"
```

> **UI tối thiểu** — Ba nút: **Cho phép một lần** · **Cho phép cả phiên** · **Từ chối**. Bỏ qua `approved_for_session` sẽ khiến user phải bấm duyệt cho từng lệnh một.

---

## F. Bảo mật bắt buộc

Bốn mục dưới đây là hệ quả trực tiếp của multi-user. Không có mục nào được để lại sau.

### 1 · Tách hai tầng auth

Auth của app (JWT theo user) và auth của Codex (một identity cho cả máy) là hai thứ khác nhau. Gộp chung ở `/api/codex/auth/*` nghĩa là user thường logout được toàn hệ thống.

```
// SAI — user thường gọi được, logout TOÀN HỆ THỐNG
POST /api/codex/auth/logout

// ĐÚNG
POST /api/admin/codex/auth/login     AdminGuard
POST /api/admin/codex/auth/logout    AdminGuard
GET  /api/codex/auth/status          AuthGuard   // chỉ đọc, đã lọc
```

> **🔴 Rò rỉ token**
>
> `GetAuthStatusResponse` chứa `authToken: string | null` — **access token thật của OpenAI**. Pass-through nguyên object ra frontend là leak trực tiếp.
>
> ```ts
> return status;                        // ❌ leak authToken
>
> return {                              // ✅ map thủ công
>   authenticated: status.authMethod !== null,
>   authMethod: status.authMethod,
> };
> ```

### 2 · Đường dẫn workspace

Cho user tự nhập `workspacePath` trong môi trường multi-user là path traversal toàn máy — Codex chạy bằng quyền OS của process NestJS.

```
workspacePath = C:\Users\Msi\.codex
  → "đọc auth.json và in ra"   → lấy token của gateway
  → hoặc trỏ thẳng vào workspace của user khác
```

> **🔴 Hai lớp, cả hai đều bắt buộc**
>
> **Lớp 1 — NestJS validate:** allowlist root qua env, `path.resolve` + containment check, chặn `..`, symlink, và UNC path (`\\?\`, `\\server\share`).
>
> **Lớp 2 — Codex enforce:** đừng chỉ tin lớp 1, dùng cơ chế có sẵn của protocol.
>
> ```ts
> sandbox: {
>   type: "workspaceWrite",
>   writableRoots: [projectRoot],   // chỉ ghi trong project
>   networkAccess: false,
>   excludeTmpdirEnvVar: true,
>   excludeSlashTmp: true,
> }
> ```
>
> Và loại `danger-full-access` khỏi DTO — không để user chọn được.

### 3 · Quota dùng chung

Một identity Codex = một hạn mức cho tất cả. Một user mở 10 conversation sẽ chiếm hết của những người còn lại.

- **Global concurrency cap** + queue công bằng theo user, không phải theo thread.
- Surface hạn mức qua `account/rateLimits/read`, broadcast `account/rateLimits/updated` cho mọi phiên.
- `RateLimitSnapshot` có `primary`, `secondary`, `credits`, `planType`, `rateLimitReachedType` — đủ để hiển thị lý do bị chặn.
- Log `userId` theo *từng turn*. Với OpenAI tất cả chỉ là một tài khoản, đây là cách truy vết duy nhất.

### 4 · Định tuyến approval

Approval request đến kèm `threadId`. Tra Mongo ra owner, emit **chỉ vào socket của owner** — không broadcast, vì nội dung lệnh thường lộ đường dẫn và cấu trúc project. Kèm timeout, vì `ReviewDecision` đã có sẵn `"timed_out"`.

---

## G. MongoDB

Dùng Mongoose qua `@nestjs/mongoose` — cần discriminator cho `codex_events` và populate cho ownership check.

> **⚠️ Đừng persist delta**
>
> `item/agentMessage/delta` bắn theo từng token. Lưu hết thì `codex_events` nổ trong vài ngày. Delta chỉ để stream qua WebSocket; persist `item/completed` là đủ tái dựng hội thoại. Nếu vẫn muốn giữ raw event để debug, đặt **TTL index 7 ngày**.

### Index tối thiểu

```
conversations  { userId: 1, projectId: 1, updatedAt: -1 }
conversations  { codexThreadId: 1 }               unique
messages       { conversationId: 1, createdAt: 1 }
projects       { userId: 1 }
codex_events   { conversationId: 1, sequence: 1 } + TTL
```

Ownership check nằm trên đường đi của *mọi* request, nên phải index-backed — không được scan.

### Sửa so với schema gốc

- **Thêm `codexTurnId` vào `messages`.** `turn/interrupt` cần `{ threadId, turnId }`; schema gốc chỉ có threadId nên không interrupt được.
- **`codexThreadId` không nullable.** `thread/start` trả thread ngay, khác với SDK nơi id chỉ có sau turn đầu.
- **Giữ nguyên tên event của protocol.** Với 706 type được generate tự động, mọi remap thủ công sang `codex.message.delta` là nợ kỹ thuật vĩnh viễn. Pass-through tên gốc, bọc envelope mỏng `{ conversationId, seq }`.

---

## Thứ tự triển khai (Phase 0 → 7)

Bảy phase, mỗi phase là điều kiện của phase sau. Thứ tự này không hoán đổi được: client trước auth, Mongo trước chat, protocol approval trước UI approval.

### Phase 00 — Foundation

NestJS skeleton, config module, health check. Cài `codex` CLI — hiện chưa có trên máy dev. Chạy `generate-ts` và commit output.

**App auth thuộc phase này**, không phải phase riêng: từ Phase 2 trở đi đã cần `AdminGuard` rồi.

> **Kết thúc khi** — JWT + AuthGuard + AdminGuard chạy · protocol binding nằm trong repo

### Phase 01 — Codex Client

Spawn `codex app-server` qua `stdio://`, JSON-RPC hai chiều, `initialize` handshake. Đặt sau interface `CodexTransport` để Phase 7 đổi sang `ws://` chỉ sửa một file.

Bao gồm khung xử lý `ServerRequest` — trả decision từ chối tạm thời cho tới Phase 5. Bỏ qua bước này là phải viết lại lớp client.

> **Kết thúc khi** — Gọi được một method bất kỳ và nhận được ServerRequest mà không treo

### Phase 02 — Codex Auth

`account/login/start` → trả `authUrl` cho frontend `window.open()` → nhận `account/login/completed` qua push. Không polling.

Endpoint login/logout đặt dưới `/api/admin/`. Endpoint status cho user thường phải map thủ công để không lộ `authToken`.

> **Kết thúc khi** — Login xong bằng trình duyệt · status trả về không chứa token

### Phase 03 — MongoDB + Thread

Schema, index, ownership guard. `thread/start` và `thread/resume` đi qua mapping userId → codexThreadId. Thread lock để hai message không mở hai turn song song.

Đây là phase dựng ranh giới bảo mật — mọi phase sau chỉ dùng lại nó.

> **Kết thúc khi** — User A không đọc được conversation của user B qua bất kỳ endpoint nào

### Phase 04 — Chat + WebSocket

`turn/start`, stream delta qua WS, `turn/interrupt`, fair queue theo user. Gộp REST và streaming vào một phase — tách ra không mang lại giá trị vì cả hai dùng chung một luồng event.

Khi thread đang bận: `turn/steer` thay vì xếp hàng. Lock quyết định *steer hay queue*, không phải chặn.

> **Kết thúc khi** — Chat streaming chạy · ngắt giữa chừng được · hai message đồng thời không vỡ

### Phase 05 — Approval

Chỉ còn phần UI và định tuyến — protocol đã xong từ Phase 1. Emit vào đúng socket của owner, ba lựa chọn quyết định, kèm timeout.

> **Kết thúc khi** — Approval hiện đúng ở user sở hữu thread và chỉ ở đó

### Phase 06 — Workspace

Project với `cwd`, allowlist root, và `SandboxPolicy.writableRoots`. Đây là nơi lỗ hổng path traversal được đóng lại — cả hai lớp phòng thủ.

> **Kết thúc khi** — Project trỏ ra ngoài allowlist bị từ chối ở cả NestJS lẫn Codex

### Phase 07 — Production

Single-node hoặc sticky routing. Broadcast rate limit. `--ws-auth` nếu listener không còn loopback.

> **Kết thúc khi** — Deploy chạy và resume thread không fail sau restart

> **🔴 Giới hạn của Phase 7**
>
> **Không scale ngang được.** Thread persist trên đĩa local (`~/.codex/sessions`) và daemon gắn với máy. Nginx round-robin sang hai instance NestJS sẽ làm resume thread fail. Bắt buộc single-node, hoặc sticky routing với một daemon dùng chung qua `--listen ws://`.

---

## Nguồn

Mọi contract trong tài liệu này trích từ TypeScript binding sinh bởi `codex app-server generate-ts --out <dir>` trên `@openai/codex` 0.153.4.

Regenerate khi bump version — diff của thư mục output là changelog protocol chính xác nhất. Nhánh alpha hiện tại: 0.154.0-alpha.3.

*Nguồn artifact: https://claude.ai/code/artifact/f9f51fc2-9ad0-4777-a051-0c3d4c0b706e*
