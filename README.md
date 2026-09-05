# Codex Gateway

Backend NestJS trung gian giữa app của bạn và **Codex app-server**.

Frontend không bao giờ nói chuyện trực tiếp với Codex. Mọi thứ đi qua gateway này:
xác thực người dùng, phân tách dữ liệu giữa các user, và bọc kín giao thức JSON-RPC
của Codex.

> **Trạng thái: hoàn tất Phase 0–7 + giao diện Next.js.**
> Kiến trúc đầy đủ và thứ tự 8 phase nằm ở [`docs/codex-gateway-blueprint.md`](docs/codex-gateway-blueprint.md).

---

## Yêu cầu

- Node.js >= 20
- npm
- MongoDB đang chạy (mặc định `mongodb://127.0.0.1:27017/codex-gateway`)

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
npm run start:dev     # gateway, cổng 3000
```

Giao diện web nằm ở [`web/`](web) và chạy riêng:

```bash
cd web
npm install
npm run dev           # cổng 3001
```

Cổng 3001 không phải tuỳ tiện: gateway chỉ chấp nhận origin nằm trong
`CORS_ORIGINS`, và mặc định là `http://localhost:3001`. Đổi cổng thì phải đổi cả hai.

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
| `GET` | `/api/projects` | cần đăng nhập — **chỉ của mình** |
| `POST` | `/api/projects` | cần đăng nhập — path phải trong allowlist |
| `GET` | `/api/projects/:id` | cần đăng nhập |
| `PATCH` | `/api/projects/:id` | cần đăng nhập — đổi tên |
| `DELETE` | `/api/projects/:id` | cần đăng nhập — chỉ xoá bản ghi |
| `POST` | `/api/conversations` | cần đăng nhập — nhận `projectId` tuỳ chọn |
| `GET` | `/api/conversations` | cần đăng nhập — **chỉ của mình** |
| `GET` | `/api/conversations/:id` | cần đăng nhập — chỉ của mình |
| `POST` | `/api/conversations/:id/resume` | cần đăng nhập — nạp lại thread |
| `DELETE` | `/api/conversations/:id` | cần đăng nhập — xoá cả thread |
| `GET` | `/api/conversations/:id/messages` | cần đăng nhập — lịch sử |
| `POST` | `/api/conversations/:id/messages` | cần đăng nhập — gửi tin, trả `202` |
| `POST` | `/api/conversations/:id/interrupt` | cần đăng nhập — dừng turn |
| `GET` | `/api/conversations/:id/approvals` | cần đăng nhập — lịch sử xin phép |
| `POST` | `/api/approvals/:id/resolve` | cần đăng nhập — duyệt/từ chối |
| `GET` | `/api/admin/users` | **admin** |
| `POST` | `/api/admin/users` | **admin** — tạo tài khoản |
| `PATCH` | `/api/admin/users/:id/active` | **admin** — bật/tắt tài khoản |
| `GET` | `/api/codex/auth/status` | cần đăng nhập — Codex đã login chưa |
| `GET` | `/api/codex/rate-limits` | cần đăng nhập — hạn mức dùng chung |
| `POST` | `/api/codex/rate-limits/refresh` | cần đăng nhập — đọc lại từ Codex |
| `GET` | `/api/admin/codex/auth/status` | **admin** — kèm tài khoản và login đang chờ |
| `POST` | `/api/admin/codex/auth/login` | **admin** — lấy URL đăng nhập |
| `POST` | `/api/admin/codex/auth/login/cancel` | **admin** |
| `POST` | `/api/admin/codex/auth/logout` | **admin** — đăng xuất cho *mọi* user |
| `GET` | `/health` | công khai — liveness cho load balancer |
| `GET` | `/health/codex` | cần đăng nhập — binary + trạng thái app-server |

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
│   ├── app-server/  client JSON-RPC hai chiều
│   ├── binary/      tìm executable Codex
│   └── protocol/    bindings generated — không sửa tay
├── common/        guards, decorators, exception filter
├── config/        env validation + config tree có kiểu
└── health/
```

Không nơi nào ngoài `src/config/` đọc `process.env`.

---

## Codex client

Gateway nói chuyện với Codex qua `codex app-server`, spawn bằng stdio.

**Giao thức đã đo trên binary 0.153.4**, không lấy từ tài liệu:

| | |
|---|---|
| Framing | JSONL — một JSON mỗi dòng, không `Content-Length` |
| Request | `{id, method, params}` — **không** có field `jsonrpc` |
| Response | `{id, result}` hoặc `{id, error:{code, message}}` |
| Handshake | `initialize` → response → notification `initialized` |

Ba lớp, tách bằng interface:

```
CodexClientService     request() / notify() / on()
        │              không ai bên ngoài biết envelope
CodexTransport         cổng — stdio hôm nay, ws:// ở Phase 7
        │
StdioTransport         spawn + ghép frame JSONL
```

### Vì sao hai chiều ngay từ đầu

Approval của Codex đến dưới dạng **request từ server**, và app-server **chờ ta trả lời**.
Nếu Phase 1 chỉ dựng luồng event một chiều thì tới Phase 5 phải viết lại toàn bộ lớp client.

`ServerRequestRegistry` đã có sẵn đường đi đó. Hiện chưa đăng ký responder nào, nên mọi
request đều rơi vào từ chối an toàn — đúng shape mà từng method mong đợi:

| Method | Trả về khi chưa có UI |
|---|---|
| `item/commandExecution/requestApproval` | `{decision: "decline"}` |
| `item/fileChange/requestApproval` | `{decision: "decline"}` |
| `execCommandApproval`, `applyPatchApproval` | `{decision:{denied:{rejection}}}` |
| còn lại | error `-32601` |

Điều quan trọng nhất: **không bao giờ im lặng**. Im lặng làm app-server treo.
Phase 5 chỉ cần `registry.register(method, responder)` để thay chỗ từ chối bằng người thật.

### CODEX_HOME

Log lúc boot in ra `Codex home:` lấy từ `InitializeResponse`, tức là sự thật do server báo
chứ không phải giá trị ta đoán. Biến này **kế thừa từ môi trường** của process cha, nên nó
có thể không phải `~/.codex` như bạn tưởng. Nó quyết định credential và lịch sử thread nằm ở
đâu — đáng nhìn mỗi lần khởi động.

## Đăng nhập Codex

Codex chỉ có **một identity cho cả máy**, nên login/logout là hành động phạm vi toàn host và
nằm sau `AdminGuard`. Một user đăng xuất là đăng xuất tất cả.

```bash
# 1. admin lấy URL
curl -X POST localhost:3000/api/admin/codex/auth/login -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 2. mở url trả về trong trình duyệt, đăng nhập ChatGPT

# 3. xong — không cần polling, Codex đẩy notification account/login/completed
curl localhost:3000/api/codex/auth/status -H "Authorization: Bearer $TOKEN"
```

### Browser hay device code

`POST /login` nhận `{"method": "browser"}` (mặc định) hoặc `{"method": "deviceCode"}`.

Khác biệt không phải chuyện tiện lợi. URL của luồng browser chứa:

```
redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback
```

Callback rơi vào **loopback của máy đang chạy Codex**. Trình duyệt của admin phải ở *cùng máy*
với gateway thì mới hoàn tất được — đúng trong môi trường dev, **sai khi deploy remote**.

Deploy lên server thì dùng `deviceCode`: trả về một URL công khai kèm mã ngắn
(`VX6J-41MCW`), nhập ở bất kỳ thiết bị nào, không cần chạm tới loopback của server.

### Hai thứ không bao giờ ra khỏi process

**Access token.** `GetAuthStatusResponse` có field `authToken` là token OpenAI thật. Service
gọi với `includeToken: false` và **dựng response theo từng field**, không bao giờ spread
nguyên object. Có test khẳng định điều này bằng một token giả có thể nhận diện.

**Login URL.** Ai mở URL đó và đăng nhập sẽ gắn tài khoản ChatGPT *của họ* vào gateway này.
Đó là leo thang đặc quyền, nên URL chỉ xuất hiện ở endpoint admin — `/api/codex/auth/status`
của user thường chỉ có `state`, không có URL.

### Trạng thái pending nằm trong bộ nhớ

Login đang chờ được giữ trong RAM và **mất khi restart gateway**. TTL 10 phút là do gateway
đặt ra, Codex không báo hạn. Restart giữa chừng thì chỉ cần gọi `/login` lại.

---

## Ranh giới sở hữu

Đây là phần quan trọng nhất của toàn bộ project.

App-server **không có khái niệm user**. `thread/list` không nhận filter theo chủ sở hữu và
trả về mọi thread trên máy. Nên quyền sở hữu chỉ tồn tại ở một chỗ: collection
`conversations` trong MongoDB.

```
request  →  JwtAuthGuard  →  requireOwned(userId, conversationId)  →  codexThreadId  →  Codex
                                        ↑
                            cổng duy nhất. Không route nào
                            nhận threadId từ client.
```

Ba quy tắc, đã kiểm chứng bằng test và bằng HTTP thật:

1. **Không bao giờ proxy `thread/list`.** Luôn query Mongo theo `userId` trước.
2. **Trả 404, không phải 403**, cho conversation của người khác. Trả 403 là xác nhận id đó
   có tồn tại — bản thân điều đó đã là rò rỉ.
3. **Admin không phải superuser trên conversation.** Admin quản trị host và tài khoản;
   admin đọc conversation của user khác vẫn nhận 404.

### Vô hiệu hoá tài khoản chấm dứt phiên ngay

Token được resolve lại với store trên *mỗi* request, nên `PATCH /admin/users/:id/active`
với `false` làm token đang dùng chết ngay lập tức — không cần chờ hết hạn. Cũng vì vậy,
**role đọc từ database chứ không từ claim trong token**.

### Thread rỗng chưa ghi xuống đĩa

Codex chỉ materialize thread lên đĩa khi nó **có nội dung**. Nên conversation vừa tạo mà
chưa gửi tin nhắn nào thì `resume` trả 409 (`no rollout found`), và thread đó **không sống
sót qua một lần restart app-server**.

Phase 4 phải xử lý trường hợp thread biến mất: tạo thread mới và trỏ lại `codexThreadId`.

### Thread lock

`ThreadLockService` xếp hàng mọi thao tác theo từng thread, để hai request đồng thời không
mở hai turn trên cùng một thread. Bản in-process này đúng chừng nào chỉ có một process
gateway sở hữu thread — cùng giả định single-node mà thread state trên đĩa đã áp đặt.
Phase 7 đổi sang Redis nếu điều đó không còn đúng.

---

## Chat và WebSocket

`POST /messages` trả **202 ngay lập tức** kèm `{messageId, turnId, disposition}`. Không có
gì chờ model — câu trả lời đến qua WebSocket.

### Kết nối

```js
const socket = io('http://localhost:3000/codex', { auth: { token: jwt } });

socket.on('codex.connected', ({ userId }) => {
  socket.emit('conversation.join', { conversationId }, (res) => console.log(res));
});

socket.on('codex.event', ({ conversationId, method, params }) => {
  if (method === 'item/agentMessage/delta') append(params.delta);
});
```

Token đi trong `auth` của handshake, không phải query string — query string sẽ nằm lại
trong log của proxy.

Sự kiện gửi xuống là **một kênh duy nhất** `codex.event`, giữ nguyên tên method của
protocol. Client `switch` theo `method`. Với 706 binding được sinh tự động, dựng một bộ
tên song song chỉ tạo thêm một lớp dịch phải bảo trì mãi mãi.

### Phòng thủ

- Socket xác thực lúc connect, và **kiểm tra quyền sở hữu lại ở mỗi lần join** — socket
  sống lâu, conversation có thể đã bị xoá.
- Sự kiện phát theo *room*, không broadcast: payload chứa lệnh đã chạy và đường dẫn file.
- Notification của thread không thuộc gateway này (client Codex khác trên cùng máy) bị
  **bỏ qua**, không phát cho ai.

### Hai message cùng lúc

Một thread chạy một turn tại một thời điểm. `ThreadLockService` khoá quanh đoạn
đọc-quyết-định-ghi, rồi:

| Tình huống | Hành động |
|---|---|
| Không có turn đang chạy | `turn/start` → `disposition: "started"` |
| Đang có turn | `turn/steer` với `expectedTurnId` → `disposition: "steered"` |

Đã kiểm chứng: gửi hai message đồng thời cho ra **cùng một `turnId`**, không mở hai turn.
`expectedTurnId` là điều kiện tiên quyết — nếu turn kết thúc giữa lúc đọc và lúc gọi,
Codex từ chối thay vì steer nhầm turn.

### Hàng đợi công bằng

Mọi user dùng chung một quota Codex. `MAX_CONCURRENT_TURNS` (mặc định 4) giới hạn tổng,
`MAX_TURNS_PER_USER` (mặc định 2) ngăn một tài khoản chiếm hết. Khi có slot trống, hàng
đợi **bỏ qua** người đang chạm trần của chính họ để nhường người khác.

Slot giữ suốt turn, không chỉ lúc gọi `turn/start` — vì lệnh đó trả về ngay khi turn bắt
đầu. Slot được trả lại khi `turn/completed` hoặc khi có lỗi kết thúc turn, kèm timeout an
toàn 15 phút phòng khi notification thất lạc.

### Lưu gì, không lưu gì

| | |
|---|---|
| `item/agentMessage/delta` | **không ghi DB** — stream, và đệm trong RAM |
| `item/completed` (agentMessage) | điền vào `messages`, xoá đệm |
| `item/completed` (userMessage) | bỏ qua — đã lưu lúc gửi |
| `item/completed` (lệnh, file, tool) | `codex_events`, **TTL 7 ngày** |
| `turn/completed`, `error` | cập nhật trạng thái, flush đệm nếu cần |

Ghi thất bại **không** làm mất stream của người dùng — mất nhật ký còn hơn mất câu trả lời.

### Vì sao có đệm

Turn bị interrupt **không bao giờ phát `item/completed`**. Nếu chỉ dựa vào sự kiện đó,
người dùng cắt giữa chừng rồi tải lại sẽ thấy một bong bóng trống — dù họ vừa nhìn text
chạy trên màn hình.

Nên delta được cộng dồn trong RAM theo từng turn (trần 1 MB), và chỉ ghi xuống DB khi turn
kết thúc bất thường. Turn hoàn tất bình thường thì `item/completed` thắng và đệm bị bỏ.

Đã kiểm chứng trên turn thật: thấy 277 ký tự trước khi cắt, lưu lại đúng 277 ký tự.

---

## Approval

Codex hỏi xin phép bằng **request từ server**, và app-server **đứng chờ** câu trả lời.
Nguyên tắc bất di bất dịch: **không bao giờ im lặng**.

```
Codex ──request──> ServerRequestRegistry ──> ApprovalsService
                                                   │ lưu row, phát WS
                                                   ▼
                                          đúng socket của CHỦ SỞ HỮU
                                                   │
                                            người bấm nút
                                                   │
Codex <──accept / decline────────────────────────┘
```

Trả lời qua REST (`POST /api/approvals/:id/resolve`) hoặc thẳng trên socket đang mở
(`approval.resolve`). Ba lựa chọn: `allow`, `allowForSession`, `deny`.

Sự kiện đi cùng kênh `codex.event` nhưng tên method có tiền tố `gateway/` —
`gateway/approval.requested` và `gateway/approval.resolved` — để client phân biệt cái gì
đến từ Codex, cái gì từ gateway.

| Điều | Cách xử lý |
|---|---|
| Không ai trả lời trong `APPROVAL_TIMEOUT_MS` (mặc định 5 phút) | tự `decline`, đánh dấu `timedOut` |
| Thread không thuộc gateway này | `decline` ngay, không tạo row |
| Người khác thử duyệt hộ | **404** — như conversation |
| Duyệt lần thứ hai | 404 |
| Gateway restart giữa chừng | row thành `abandoned`, Codex đã hết chờ |

`item/permissions/requestApproval` **cố ý không nhận**: response type của nó đòi một
`GrantedPermissionProfile` đầy đủ và **không có cách nào biểu đạt sự từ chối**, nên một
hộp thoại có/không không trả lời được. Nó tiếp tục rơi vào error reply của registry.

Row `approvals` được giữ lại sau khi quyết định — đó là bằng chứng agent đã được cho phép
làm gì, trên workspace của ai, do ai duyệt.

---

## Sandbox nền tảng

**Bắt buộc phải cấu hình**, nếu không Codex sẽ không sửa được file — mà không báo gì.

```bash
npm run codex:sandbox              # kiểm tra
npm run codex:sandbox -- --setup   # cấu hình
```

Gateway gửi `sandbox: "workspace-write"` lúc `thread/start`. Khi sandbox chưa sẵn sàng,
máy chủ **âm thầm hạ xuống** `readOnly` thay vì chạy không sandbox. Đo trực tiếp, trước và
sau khi cấu hình:

| Gửi lên | Chưa cấu hình | Đã cấu hình |
|---|---|---|
| `workspace-write` | `readOnly` ← **hạ ngầm** | `workspaceWrite` |
| bỏ trống | `readOnly` | `workspaceWrite` |
| `read-only` | `readOnly` | `readOnly` |
| `danger-full-access` | `dangerFullAccess` | `dangerFullAccess` |
| `workspaceWrite` | lỗi — sai tên biến thể | lỗi |

Từ chối cấp quyền ghi khi chưa có sandbox là hành vi đúng, nhưng nó im lặng. Nên gateway
đọc `windowsSandbox/readiness` mỗi lần kết nối, cảnh báo lúc boot nếu chưa sẵn sàng, và
đưa vào `/health/codex`:

```json
"appServer": { "sandbox": "ready", ... }
```

Lưu ý `writableRoots` trả về **rỗng** — vùng ghi được suy ra từ `cwd`, không liệt kê.

### Sandbox làm gì, approval làm gì

Hai thứ khác nhau, đã kiểm chứng trên máy thật:

| Hành động | Kết quả |
|---|---|
| Ghi file **trong** workspace | chạy thẳng, **không hỏi** — sandbox đã cấp quyền đó |
| Ghi file **ngoài** workspace | sandbox chặn → **leo thang thành approval** |
| Từ chối approval đó | file **không** được tạo |

Sandbox là lớp thực thi; approval chỉ xuất hiện khi cần **thoát** khỏi nó. Đừng trông đợi
approval cho mọi thao tác — nếu thấy im lặng bất thường, kiểm tra `sandbox` trong health
trước tiên.

---

## Workspace

`CODEX_WORKSPACE_ROOTS` là danh sách thư mục gateway được phép chạy thread, cách nhau bằng
dấu phẩy. **Không gì ngoài các root đó tới được**, dù đường dẫn viết cách nào.

### Lớp 1 — NestJS validate

`WorkspacePathService.resolveWithin()` là cổng duy nhất. Mỗi phép kiểm tồn tại vì một lối
thoát cụ thể:

| Chặn | Vì sao |
|---|---|
| Đường dẫn tương đối | không so sánh được với root |
| `\server\share`, `//host/share` | chạm tới ổ mạng, và né được chuẩn hoá |
| Byte `NUL` | cắt cụt đường dẫn trong native call — cái kiểm và cái mở khác nhau |
| `..` | `path.resolve` gộp lại trước khi so |
| **Symlink / junction** | `realpath` bám tới đích thật; link *nằm trong* root vẫn có thể trỏ ra ngoài |
| Thư mục không tồn tại / là file | không realpath được, và không phải nơi chạy được |
| `\/srv/work-secrets` khi root là `\/srv/work` | so sánh có kèm dấu phân cách, không phải `startsWith` trần |

Đường dẫn lưu vào DB là **dạng canonical** đã resolve, không phải chuỗi người dùng gõ —
vì đó mới là thứ sandbox thực thi. Lưu bản gõ tay sẽ khiến giá trị lưu và giá trị được
thực thi lệch nhau.

Kiểm lại **mỗi lần dùng**, không chỉ lúc tạo: allowlist có thể đã bị thu hẹp, hoặc thư mục
đã bị thay bằng một symlink, kể từ lúc project được thêm.

### Lớp 2 — Codex enforce

`thread/start` chạy với `cwd` = thư mục project và `sandbox: workspace-write`. Sandbox mới
là thứ thực sự chặn. Đã kiểm chứng: yêu cầu ghi ra thư mục cha bị sandbox chặn → leo thang
thành approval → từ chối → **file không được tạo**.

### Không có project thì sao

Mỗi user được một thư mục **riêng**: `<root>/users/<userId>`, gateway tự tạo.

Không dùng chung một thư mục mặc định, vì `workspace-write` cho agent đọc *và* ghi khắp
`cwd` — một thư mục dùng chung đồng nghĩa agent của người này đi lại được trong file của
mọi người khác. Đường dẫn đó do gateway ghép từ root và userId, không lấy từ client, nên
tự tạo nó là an toàn.

Path của project thì **phải có sẵn** — gateway không tạo thư mục từ chuỗi người dùng nhập.

---

## Vận hành

### Chỉ được một instance

Gateway giữ một **lease trong MongoDB**. Instance thứ hai bị từ chối khởi động:

```
ERROR [Bootstrap] Another Codex Gateway is already running on DESKTOP-XXX (pid 3656).
Two gateways sharing one CODEX_HOME corrupt thread history and race approvals.
```

Đây là biến "single-node" từ một dòng ghi chú thành một bảo đảm. Hai gateway dùng chung
`CODEX_HOME` sẽ mỗi bên spawn một app-server trên **cùng lịch sử thread trên đĩa**, tranh
nhau trả lời approval, và gán cho một conversation hai turn khác nhau.

Lease đặt trong Mongo chứ không phải lockfile, vì sai lầm này dễ xảy ra nhất khi chạy trên
**hai máy khác nhau** — chỗ mà lockfile không thấy gì.

Sau khi crash, restart **không phải chờ**: nếu lease thuộc cùng host, gateway kiểm tra pid
đó còn sống không (`kill(pid, 0)`) và tiếp quản ngay. Lease của host khác luôn được coi là
còn sống — một pid ở máy khác không nói lên điều gì ở đây.

Chạy nhiều instance có chủ đích thì đặt `ALLOW_MULTIPLE_INSTANCES=true`, **chỉ khi** chúng
không dùng chung `CODEX_HOME`.

### Restart dọn việc dở dang

Turn, câu trả lời và hộp thoại approval đều sống một phần trong RAM. Restart cắt cả ba, và
sẽ **không có notification nào tới để đóng chúng lại**.

Lúc bootstrap, gateway settle hết: conversation về `idle`, message `pending` thành
`interrupted`, approval `pending` thành `abandoned`.

```
WARN [StartupReconcilerService] Settled work interrupted by the last shutdown:
     0 conversation(s), 1 reply(ies), 0 approval(s)
```

Không có bước này, user quay lại thấy conversation kẹt "running" vĩnh viễn.

**Đã kiểm chứng**: tạo conversation, gửi message, kill gateway, khởi động lại — lịch sử
còn nguyên, `POST /resume` trả 200, và Codex vẫn **nhớ ngữ cảnh từ trước restart**.

### Hạn mức dùng chung

Mọi user tiêu chung một quota. `GET /api/codex/rate-limits` trả snapshot, và mỗi thay đổi
được **broadcast tới toàn bộ socket** qua sự kiện `codex.quota`. Client mới kết nối nhận
ngay số hiện tại, không phải chờ thay đổi kế tiếp.

Cập nhật từ Codex là **sparse**: field `null` nghĩa là "không đổi", không phải "xoá". Nên
gateway **merge** chứ không thay thế — thay thế sẽ xoá sạch plan và số dư credit mỗi lần
một con số usage nhúc nhích. Riêng `limitReached` thì một lần đọc đầy đủ *được phép* xoá,
vì im lặng ở đó nghĩa là hết bị chặn.

### Chặn dò mật khẩu

`POST /api/auth/login` giới hạn theo IP (`LOGIN_ATTEMPTS_PER_MINUTE`, mặc định 10), sau đó
trả `429`. Các endpoint khác đã nằm sau token — đoán mò không phải kiểu tấn công ở đó.

### Đằng sau Nginx

Transport hiện tại là **stdio**, nên không có cổng nào để bảo vệ và `--ws-auth` không cần
tới. Nếu sau này chuyển sang `--listen ws://`:

- Loopback thì Codex không bắt buộc xác thực.
- **Non-loopback thì bắt buộc** — dùng `--ws-auth capability-token` hoặc `signed-bearer-token`.

Và nhớ: thread state nằm trên đĩa local, nên **không round-robin** sang nhiều instance.
Lease ở trên sẽ chặn cấu hình đó ngay từ lúc khởi động.
