# pi-provider-manager

Quản lý các provider tương thích OpenAI cho [Pi coding agent](https://github.com/earendil-dev/pi-coding-agent) thông qua lệnh `/provider` — thêm, sửa, xóa provider và tự động cập nhật danh sách model.

Manage OpenAI-compatible providers for the Pi coding agent via the `/provider` command — add, edit, delete providers and auto-update their model lists.

## Tính năng / Features

- `/provider add` — thêm provider mới (fetch model list từ API hoặc nhập tay)
- `/provider list` — liệt kê provider đã cấu hình
- `/provider edit` — sửa base URL, API key, API mode, model list
- `/provider delete` — xóa provider khỏi `models.json` và unregister khỏi Pi
- `/provider update-models` — fetch lại danh sách model từ API
- Auto-update — tự động refresh model list khi Pi khởi động (có thể tắt)

## Cài đặt / Installation

```bash
# Từ thư mục local (đã clone repo)
pi install /path/to/pi-provider-manager

# Khi publish lên npm/git
pi install pi-provider-manager
# hoặc
pi install git+https://github.com/<user>/pi-provider-manager.git
```

Sau khi cài, khởi động lại Pi (hoặc `/reload`) để extension được nạp.

## Lệnh / Commands

| Lệnh | Mô tả |
|------|-------|
| `/provider add <name>` | Thêm provider mới (wizard: API mode → base URL → API key → models) |
| `/provider list` (hoặc `ls`) | Hiện danh sách provider (dialog) — chọn 1 provider để xem chi tiết (base URL, API key, danh sách model) |
| `/provider edit <name>` | Sửa provider (đổi API mode/base URL/key, refetch models, sửa JSON tay) |
| `/provider delete <name>` (hoặc `rm`) | Xóa provider |
| `/provider update-models <name>` (hoặc `refresh`) | Fetch lại model list từ API. Không kèm tên → chọn provider, hoặc chọn `* All providers` để update toàn bộ |

Khi có nhiều provider, Pi hiển thị model dạng `provider/model` (prefix native của Pi). File `models.json` luôn lưu **raw model id** — không đổi so với API gốc.

> 💡 **Autocomplete:** gõ `/provider ` (có space) Pi sẽ gợi ý subcommand (`add`, `list`, `edit`, `delete`, `update-models`); gõ tiếp `/provider edit ` / `delete ` / `update-models ` sẽ gợi ý tên provider đã cấu hình.

## API modes

| Giá trị | Mô tả |
|---------|-------|
| `openai-completions` | OpenAI Chat Completions (tương thích) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Claude (Anthropic Messages) |
| `google-generative-ai` | Google Gemini |

## Cấu hình / Configuration

### `~/.pi/agent/models.json` — danh sách provider (Pi đọc native)

```json
{
  "providers": {
    "my-provider": {
      "baseUrl": "https://api.example.com/v1",
      "api": "openai-completions",
      "apiKey": "$MY_PROVIDER_KEY",
      "models": [
        {
          "id": "gpt-4o",
          "contextWindow": 128000,
          "maxTokens": 16384,
          "reasoning": false,
          "input": ["text"]
        }
      ]
    }
  }
}
```

- `apiKey` nhận 3 dạng: `$ENV_VAR` (tham chiếu biến môi trường), literal key, hoặc `!command` (lệnh sinh key).
- `models[]` — mỗi entry: `id` (bắt buộc), `name?`, `contextWindow?`, `maxTokens?`, `reasoning?`, `input?` (`["text"]`/`["image"]`), `cost?`.
- Nếu sửa tay file này, chạy `/reload` trong Pi để áp dụng.

### `~/.config/pi-provider-manager/config.json` — cấu hình plugin

```json
{
  "autoUpdate": true,
  "providers": {
    "my-provider": { "autoUpdate": false }
  }
}
```

- `autoUpdate` (mặc định `true`): tự động fetch lại model list cho mọi provider khi Pi khởi động (`session_start` reason=startup).
- `providers.<name>.autoUpdate = false`: tắt auto-update cho riêng provider đó.
- Auto-update chỉ chạy lúc khởi động + lệnh tay `/provider update-models` — không chạy định kỳ trong session.

## Bảo mật / Security

- **Khuyên dùng `$ENV_VAR` thay vì literal key** trong `models.json` — key không nằm trong file cấu hình.
- File cấu hình chứa key nên đặt quyền hạn chế:

```bash
chmod 600 ~/.pi/agent/models.json ~/.config/pi-provider-manager/config.json
```

- Khi `/provider add`/`edit`, placeholder API key luôn trống (không echo key hiện tại).

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|-----------|
| Fetch model list fail (sai URL/key, mạng) | Plugin báo warning và cho nhập model id tay (comma-separated) |
| API không hỗ trợ `/v1/models` | Nhập model id tay hoặc sửa JSON trong editor |
| Sửa tay `models.json` không thấy đổi | Chạy `/reload` trong Pi |
| Provider không hiện trong `/model` | Kiểm tra `~/.pi/agent/models.json` đúng format; `/provider list` để xem |
| Muốn tắt auto-update | Sửa `~/.config/pi-provider-manager/config.json` → `autoUpdate: false` |

## English summary

`pi-provider-manager` is a Pi extension that manages OpenAI-compatible providers through `/provider` subcommands (`add`, `list`, `edit`, `delete`, `update-models`). Providers are stored in Pi's native `~/.pi/agent/models.json` (raw model ids, `provider/model` display prefix), with plugin settings in `~/.config/pi-provider-manager/config.json` (`autoUpdate`). Supported API modes: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`. Prefer `$ENV_VAR` apiKey references over literals; keep config files `chmod 600`. On startup, the plugin auto-refreshes model lists (bounded 10s per provider, skips providers with `autoUpdate: false`).

## License

MIT