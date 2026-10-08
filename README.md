# Threads 粉絲與追蹤批次管理

這是一個適用於 Threads 網頁版的開源 userscript。它讓使用者先掃描並預覽自己的名單，再逐筆移除粉絲或取消追蹤帳號。

如果你覺得這個腳本有用，請到 [GitHub 專案頁面](https://github.com/finallyface-dev/threads-safe-batch-manager)給我一顆星星。

[English](README.en.md)

> [!WARNING]
> 本專案不是 Meta 或 Threads 官方工具，也沒有獲得 Meta 授權。自動掃描與批次操作可能違反平台條款，並可能造成操作限制、登入驗證或帳號限制。每批上限與等待時間只是保守設計，不代表 Meta 認可或保證帳號安全。

專案名稱中的 `safe` 只代表官方版本加入確認、身分核對及停止機制，不代表使用帳號不會受到限制。MIT License 允許第三方修改程式碼，其他 fork 也不一定保留相同限制。

## 功能

- 可選擇啟用貼文工具：複製可辨識的可見文字，或移除網址參數與錨點後複製貼文連結。
- 貼文工具預設關閉，可在面板開啟；目前僅支援可辨識的 article 貼文容器。
- 功能構想參考 [Threads Plugin](https://github.com/Jwander0820/threads-plugin)；本次程式自行實作，未複製其程式碼。

- 移除粉絲：讓對方不再追蹤你。
- 取消追蹤：停止追蹤預覽名單中的帳號。
- 掃描階段只讀取清單，不修改追蹤關係。
- 開始前顯示本批數量與部分帳號名稱。
- 預覽可查看全部帳號，逐筆勾選、全選或取消全選，並顯示預估等待時間。
- 使用者必須輸入確認詞並通過最後確認。
- 確認以「整批」為單位，不會在每個帳號前再次詢問。若 Threads 顯示明確的原生確認視窗，腳本會接著按下該批操作所需的確認按鈕。
- 每批最多 50 筆，每筆間隔可設為 8 至 30 秒。超過 25 筆時，面板會顯示額外風險提醒。
- 支援暫停、略過目前項目，以及立即停止並清除暫存。
- 遇到 CAPTCHA、操作限制、帳號切換或不明介面時停止。
- 重新載入、上一頁／下一頁及 BFCache 還原後不會直接續跑。

## 安裝

你需要先安裝 Tampermonkey、Violentmonkey、Greasemonkey 或其他 userscript 管理器。

[安裝或查看 userscript 原始碼](https://github.com/finallyface-dev/threads-safe-batch-manager/raw/refs/heads/main/threads-safe-batch-manager.user.js)

如果瀏覽器只顯示原始碼，請在 userscript 管理器建立新腳本，貼上完整內容並儲存。

## 使用方式

1. 登入 `https://www.threads.com/`。
2. 開啟目前登入帳號自己的個人檔案。
3. 關閉畫面上原本開著的粉絲／追蹤清單。
4. 在右下角面板選擇「移除粉絲」或「取消追蹤中帳號」。
5. 設定本批上限與每筆間隔。
6. 按下「掃描並預覽」。
7. 檢查預覽後按下「確認並開始」。
8. 輸入畫面要求的確認詞，再通過最後確認。

「移除粉絲」不會替你取消追蹤對方。「取消追蹤」也不會移除對方、封鎖或檢舉對方。Threads 官方同樣把[移除粉絲](https://help.instagram.com/1414274879323976/?locale=zh_TW)與[取消追蹤](https://help.instagram.com/150298994419902/?locale=zh_TW)列為不同操作。

## 安全設計

- 只使用 Threads 頁面上可見、可唯一確認的控制項。
- 不使用未公開 GraphQL 或其他內部 API。
- 不讀取 Cookie、CSRF token、登入權杖、密碼或私人訊息。
- 所有破壞性點擊前，腳本會先保存操作階段。
- 動作結果不明時不會重複點擊同一帳號。
- 關係清單必須由腳本從已確認的本人個人檔案本次新開啟。
- 目標頁面的 handle、profile tabs、More 按鈕與關係按鈕都必須通過結構驗證。
- 找不到唯一控制項時，腳本會停止，不會猜測。
- 腳本不處理或繞過 CAPTCHA、驗證或平台限制。

## 資料與隱私

- 目標 handle 只暫存在目前分頁的 `sessionStorage`，用來接續個人檔案導航。
- `sessionStorage` 不是 userscript manager 的隔離儲存。同來源的 Threads 頁面程式可以讀取該分頁的資料；複製分頁時，瀏覽器也可能複製初始 session storage。
- 完成本批後，目標 queue 會從分頁暫存刪除。
- 腳本不會把名單、操作摘要或其他資料傳送給作者或第三方。
- 點擊 Threads 原生控制項時，Threads 網站本身仍會向 Meta 傳送正常的頁面及關係變更請求。
- 專案沒有遙測、廣告、推薦連結、挖礦、會員或付費功能。

## 支援範圍

- 網站：`https://www.threads.com/*`
- 介面文字：繁體中文、簡體中文及英文
- 2026-08-24 已在 Edge 的 Threads 繁體中文介面做唯讀 DOM 與選擇器驗證。
- 完整的真實批次執行沒有在使用者帳號上測試，以免製造追蹤關係變更。
- 其他瀏覽器、userscript manager 與介面語言組合尚未逐一驗證。

Threads 是動態網站。介面結構改版後，腳本可能安全停止並需要更新。

GitHub `main` 是開發來源。正式版本會使用與 userscript `@version` 相同的 Git tag，例如 `v1.1.0`。Raw `main` 可能變動；需要固定版本時，請使用對應 tag。

## 開發與測試

本專案不需要建置或外部套件。

```bash
node --check threads-safe-batch-manager.user.js
node --test tests/userscript.test.js
```

測試涵蓋狀態資料驗證、錯誤 storage、事件 callback、關係文字、profile selector 與關係清單列驗證。測試不會登入 Threads，也不會變更任何帳號關係。

## 專案檔案

- `threads-safe-batch-manager.user.js`：完整 userscript 原始碼。
- `GreasyFork-發布說明.md`：Greasy Fork 描述、使用方式與披露內容。
- `tests/userscript.test.js`：不連線的 Node.js 測試。
- `SECURITY.md`：安全問題回報方式。
- `CONTRIBUTING.md`：貢獻與安全邊界。
- `SHA256SUMS`：正式 userscript 檔案的 SHA-256 檢查值。

## 授權

本專案採用 [MIT License](LICENSE)。

Meta、Threads、Instagram 及相關名稱是其權利人的商標。本專案與 Meta 無隸屬、合作或背書關係。
