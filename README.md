# English Coach

Ứng dụng luyện **đọc, nghe, nói** tiếng Anh cho người Việt. AI soạn bài theo chủ đề và trình độ (A1–C1), giọng nói được nhận dạng bằng Whisper rồi chấm điểm và góp ý bằng tiếng Việt. Chạy hoàn toàn trên gói **Cloudflare Free**.

| Phần | Cách học |
|---|---|
| 🏠 Lộ trình | Mỗi bài là một "unit" với 5 nút: 🎧 nghe & xếp câu, ✍️ chép chính tả, 🎙️ luyện nói, 📖 đọc hiểu, 🏆 câu hỏi |
| 📚 Thư viện | Bài ai tạo cũng vào thư viện chung; học lại bài có sẵn không tốn lượt AI. Gõ chủ đề sẽ gợi ý bài tương tự trước khi tạo mới |
| 🎙️ Luyện nói | Ghi âm → Whisper (Workers AI) → AI chấm 0–100, tô màu từ sai/thiếu, mẹo phát âm tiếng Việt |
| ⚡ XP, 🔥 chuỗi ngày, 🎯 mục tiêu ngày, 🏅 bảng xếp hạng tuần | Kiểu Duolingo |

## Nhân vật

Hai nhân vật Live2D chuyển động: **Hiyori Momose** (minh hoạ: Kani Biimu) và **Haru**, mẫu chính thức của Live2D Inc., dùng theo [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) (cá nhân và doanh nghiệp nhỏ doanh thu dưới 10 triệu yên được dùng, kể cả thương mại, có ghi credit). License cấm phát tán lại file gốc, nên file model **không nằm trong git**: `scripts/fetch-live2d.mjs` tải chúng (và Cubism Core) vào `public/live2d/` trước mỗi lần `dev`/`build`.

## Ai dùng AI nào

| Tài khoản | AI | Giới hạn |
|---|---|---|
| `byocao` (admin, mật khẩu = secret `ADMIN_PASSWORD`) | **Claude** chạy bằng Claude Code CLI trên máy của byocao, qua bridge | Không giới hạn (theo gói Claude của bạn) |
| Thành viên được mở khoá | Workers AI (Llama 3.3 70B) | Không giới hạn (trong hạn mức free của Cloudflare) |
| Tài khoản mới | Workers AI | `TRIAL_AI_LIMIT` lượt (mặc định 15), hết thì phải liên hệ github.com/byocao |

Người dùng khác **không bao giờ** dùng gói Claude cá nhân của bạn: điều khoản của Anthropic không cho phép dùng gói Pro/Max để phục vụ người khác. Nếu muốn cho họ dùng Claude, hãy dùng API key của Claude Console.

Điểm nói phản ánh **độ rõ ràng** (Whisper nghe ra đúng chữ hay không). Nó không phân tích từng âm vị như ELSA.

## Đăng nhập

Tài khoản lưu trong D1: tên đăng nhập + mật khẩu băm PBKDF2-SHA256 (20.000 vòng, vừa giới hạn CPU 10 ms của gói Free). Sai mật khẩu 5 lần thì khoá 10 phút. Tên `byocao` được giữ riêng: không ai đăng ký được, và mật khẩu của nó là secret `ADMIN_PASSWORD` (không lưu trong D1).

## Kiến trúc

```
Trình duyệt (React) ──► Cloudflare Worker (Hono)
                          ├─ D1: users, sessions, lessons, attempts, ai_events
                          ├─ Workers AI: Whisper large-v3-turbo, Llama 3.3 70B
                          └─ Durable Object BridgeHub ◄──WebSocket── bridge/bridge.mjs (máy byocao)
                                                                     └─ claude -p --json-schema
```

## Chạy ở máy local

```bash
npm install
cp .dev.vars.example .dev.vars        # điền ADMIN_PASSWORD và BRIDGE_TOKEN
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

Đăng nhập local: tài khoản `byocao` dùng `ADMIN_PASSWORD` trong `.dev.vars`; tài khoản khác tự đăng ký ở trang đăng nhập.
Muốn dùng Whisper/Workers AI ở local thì Wrangler phải đăng nhập đúng tài khoản Cloudflare. Không có thì chạy `EC_OFFLINE=1 npm run dev` (mọi thứ khác vẫn chạy).

Bridge Claude, chạy trong cửa sổ terminal thứ hai:

```bash
cp bridge/.env.example bridge/.env    # APP_URL + BRIDGE_TOKEN giống .dev.vars
npm run bridge
```

## Deploy lên Cloudflare (Free)

1. `npx wrangler login` bằng tài khoản Cloudflare của bạn.
2. `npx wrangler d1 create english-coach`, rồi chép `database_id` vào `wrangler.jsonc`.
3. `npm run db:migrate:remote`
4. Đặt secrets:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put BRIDGE_TOKEN
   ```
5. `npm run deploy`
6. Trên máy bạn: đặt `APP_URL` trong `bridge/.env` thành URL workers.dev, rồi `npm run bridge`.

## Hạn mức miễn phí

- Workers AI: 10.000 neurons/ngày, đủ cho khoảng 100–150 lượt chấm hoặc tạo bài mỗi ngày. Whisper tốn khoảng 47 neurons cho mỗi phút âm thanh. Khi hết, app báo người dùng thử lại sau 00:00 UTC.
- Workers: 100.000 request/ngày. D1: 5 GB. Durable Objects (SQLite): có trong gói Free.

## Cấu hình (`wrangler.jsonc` → `vars`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ADMIN_LOGIN` | `byocao` | Tên đăng nhập được quyền admin và dùng Claude |
| `TRIAL_AI_LIMIT` | `15` | Số lượt AI cho tài khoản dùng thử |
| `CONTACT_URL` | `https://github.com/byocao` | Link liên hệ khi hết lượt |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Model cho người không phải admin |
