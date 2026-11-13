# Wancha – Học tiếng Anh cùng Wanko

Ứng dụng luyện **đọc, nghe, nói** tiếng Anh cho người Việt. AI soạn bài theo chủ đề và trình độ (A1–C1), giọng nói được nhận dạng bằng Whisper rồi chấm điểm và góp ý bằng tiếng Việt. Chạy hoàn toàn trên gói **Cloudflare Free**.

| Phần | Cách học |
|---|---|
| Lộ trình | **Khoá học có sẵn 40 bài**, A1 → C1, 10 chủ đề (đời sống, ăn uống, du lịch, công việc, học tập, công nghệ, sức khoẻ, giải trí, thiên nhiên, con người). Mỗi bài là một nút trên bản đồ, đi qua 6 bước |
| 6 bước mỗi bài | Từ vựng (lật thẻ, ghép cặp, điền từ, nghe chọn từ) · Nghe & xếp câu · Chép chính tả · Luyện nói · Đọc hiểu · Thử thách |
| Thư viện | Khoá học + bài ai tạo cũng vào thư viện chung, lọc theo chủ đề và cấp độ. Học lại bài có sẵn không tốn lượt AI. Gõ chủ đề sẽ gợi ý bài tương tự trước khi tạo mới |
| Luyện nói | Ghi âm → Whisper (Workers AI) → AI chấm 0–100, tô màu từ sai/thiếu, mẹo phát âm tiếng Việt |
| Xếp lớp | Bài kiểm tra thích ứng tối đa 12 câu (ngữ pháp, từ vựng, nghe, đọc) xếp mỗi tài khoản vào A1–C1; lộ trình bắt đầu từ cấp đó. Làm lại hoặc đổi cấp trong Hồ sơ |
| Game | XP, chuỗi ngày, mục tiêu ngày, 3 nhiệm vụ hằng ngày, combo đúng liên tiếp, giải đấu tuần |

## Nhân vật

Nhân vật Live2D chuyển động: **Wanko**, **Hiyori Momose** (minh hoạ: Kani Biimu) và **Haru**, mẫu chính thức của Live2D Inc., dùng theo [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) (cá nhân và doanh nghiệp nhỏ doanh thu dưới 10 triệu yên được dùng, kể cả thương mại, có ghi credit). License cấm phát tán lại file gốc, nên file model **không nằm trong git**: `scripts/fetch-live2d.mjs` tải chúng (và Cubism Core) vào `public/live2d/` trước mỗi lần `dev`/`build`.

Icon: [Phosphor Icons](https://phosphoricons.com) (MIT), dạng đặc, mỗi khái niệm một màu.

**Bạn đồng hành** (chọn trong Hồ sơ): Wanko (cún trong tách trà, mặc định), Hiyori, Haru. Hai bé mèo **Tororo & Hijiki** cũng là mẫu miễn phí của Live2D nhưng trang tải yêu cầu bấm đồng ý điều khoản, nên không tự tải được: vào https://www.live2d.com/en/learn/sample/tororo-hijiki/, tải bản runtime, giải nén vào thư mục `live2d-extra/` (đã gitignore) rồi `npm run deploy`. Script build tự nhận mọi `*.model3.json` trong đó.

## Khoá học có sẵn

Nội dung nằm trong `seed/lessons/A1.json` … `C1.json` (mỗi file 8 bài). Sửa hoặc thêm bài rồi:

```bash
npm run seed:check          # kiểm tra định dạng, độ dài câu, từ vựng có trong bài…
npm run db:seed:remote      # ghi đè/thêm vào D1 (chạy lại bao nhiêu lần cũng được)
```

## Ai dùng AI nào

| Chức năng | AI | Giới hạn mỗi tài khoản (trừ `byocao`) |
|---|---|---|
| Tạo bài học riêng | **Claude Opus 5.5** (Claude API) | `LESSON_LIMIT` bài (mặc định 1) |
| Chấm điểm phát âm | Whisper (Workers AI) nghe, **Claude Haiku 5.5** chấm | `GRADE_LIMIT` lần (mặc định 10) |
| Giải thích câu | Workers AI (Llama 3.3 70B), miễn phí | Không giới hạn (trong hạn mức free của Cloudflare) |

`byocao` (admin, mật khẩu = secret `ADMIN_PASSWORD`) không bị giới hạn lượt. Mỗi lần gọi Claude API được ghi vào bảng `ai_spend` kèm số token và chi phí. Khi tổng chi phí trong tháng (theo giờ UTC) chạm `MONTHLY_BUDGET_USD` (mặc định $70), tạo bài và chấm điểm chuyển sang "đang bảo trì" cho mọi người, kể cả admin, đến đầu tháng sau. Trang Quản trị hiện chi phí tháng này theo từng model, và nút "Cấp lại lượt" trả lại lượt cho một tài khoản.

Điểm nói phản ánh **độ rõ ràng** (Whisper nghe ra đúng chữ hay không). Nó không phân tích từng âm vị như ELSA.

## Đăng nhập

Tài khoản lưu trong D1: tên đăng nhập + mật khẩu băm PBKDF2-SHA256 (20.000 vòng, vừa giới hạn CPU 10 ms của gói Free). Sai mật khẩu 5 lần thì khoá 10 phút. Tên `byocao` được giữ riêng: không ai đăng ký được, và mật khẩu của nó là secret `ADMIN_PASSWORD` (không lưu trong D1).

## Kiến trúc

```
Trình duyệt (React) ──► Cloudflare Worker (Hono)
                          ├─ D1: users, sessions, lessons, lesson_progress, xp_events, attempts
                          ├─ D1: ai_spend (token và chi phí từng lần gọi Claude)
                          ├─ Workers AI: Whisper large-v3-turbo, Llama 3.3 70B
                          └─ Claude API: Opus 5.5 (tạo bài), Haiku 5.5 (chấm điểm)
```

## Chạy ở máy local

```bash
npm install
cp .dev.vars.example .dev.vars        # điền ADMIN_PASSWORD và ANTHROPIC_API_KEY
npm run db:migrate:local
npm run db:seed:local                 # nạp 40 bài có sẵn
npm run dev                           # http://localhost:5173
```

Đăng nhập local: tài khoản `byocao` dùng `ADMIN_PASSWORD` trong `.dev.vars`; tài khoản khác tự đăng ký ở trang đăng nhập.
Muốn dùng Whisper/Workers AI ở local thì Wrangler phải đăng nhập đúng tài khoản Cloudflare. Không có thì chạy `EC_OFFLINE=1 npm run dev` (mọi thứ khác vẫn chạy).

## Deploy lên Cloudflare (Free)

1. `npx wrangler login` bằng tài khoản Cloudflare của bạn.
2. `npx wrangler d1 create english-coach`, rồi chép `database_id` vào `wrangler.jsonc`.
3. `npm run db:migrate:remote` rồi `npm run db:seed:remote`
4. Đặt secrets:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
5. `npm run deploy`

## Hạn mức miễn phí

- Workers AI: 10.000 neurons/ngày. Whisper tốn khoảng 47 neurons cho mỗi phút âm thanh. Khi hết, app báo người dùng thử lại sau 00:00 UTC.
- Workers: 100.000 request/ngày. D1: 5 GB.
- Claude API tính tiền theo token, giới hạn bởi `MONTHLY_BUDGET_USD` ở trên.

## Cấu hình (`wrangler.jsonc` → `vars`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ADMIN_LOGIN` | `byocao` | Tên đăng nhập được quyền admin (không giới hạn lượt) |
| `CONTACT_URL` | `https://github.com/byocao` | Link liên hệ khi hết lượt |
| `LESSON_MODEL` | `claude-opus-5-5` | Model tạo bài học riêng |
| `GRADE_MODEL` | `claude-haiku-5-5` | Model chấm điểm phát âm |
| `LESSON_LIMIT` | `1` | Số bài riêng mỗi tài khoản được tạo |
| `GRADE_LIMIT` | `10` | Số lần chấm điểm mỗi tài khoản |
| `MONTHLY_BUDGET_USD` | `70` | Chi phí Claude API tối đa mỗi tháng trước khi chuyển sang "bảo trì" |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Model giải thích câu |

Secret `ANTHROPIC_API_KEY`: khoá Claude API (`npx wrangler secret put ANTHROPIC_API_KEY`).
