# Cow Meadow 🐄

Game 3D thế giới mở: dắt bò đi dạo trên đồng cỏ, chơi nhiều người trong cùng một map.

## Chạy game

Cần [Node.js](https://nodejs.org). Không cần `npm install`.

Bấm đúp **`start.bat`**. File này sẽ:
1. bật server game (`node server.js`) ở cổng 5173
2. mở trình duyệt vào `http://localhost:5173`
3. nếu máy có ngrok thì mở tunnel ra Internet

## Cấu trúc thư mục

```
server.js              điểm khởi động (node server.js) -> server/index.js
server/                code chạy trên server (Node.js)
  index.js             HTTP server: file tĩnh, API, WebSocket, tắt server an toàn
  config.js            cấu hình + luật chơi (level, XP, sát thương...)
  game.js              người chơi online, giao thức tin nhắn, chat/admin, snapshot, autosave
  api.js               /api/register, /api/login, /api/logout, /api/me, /api/clan/*
  accounts.js          băm mật khẩu, phiên đăng nhập, lưu tiến trình
  clans.js             tạo / quản lý clan
  economy.js           sữa, bán sữa, cửa hàng, mất xu khi chết
  admin.js             API quản trị (giá sữa, vật phẩm, giao dịch, người chơi)
  db.js                MongoDB hoặc file JSON (users, players, sessions, clans)
  world-clock.js       ngày/đêm, mùa, thời tiết ngẫu nhiên
  websocket.js         WebSocket tự viết (RFC 6455)
  static.js            chỉ phục vụ file trong public/
  public-url.js        link ngrok / Render / LAN cho nút "Mời bạn"
  util.js, http-util.js
public/                mọi thứ trình duyệt tải về
  index.html, css/style.css
  js/main.js           khởi động game, vòng lặp, điều khiển, HUD
  js/game/             levels.js, config.js (luật chơi + preset đồ hoạ)
  js/world/            terrain, grass, water, sky, environment (mùa/thời tiết), world (cây, đá), crocs, weather-fx (mưa, tuyết, lá), farm (khu vắt sữa + chợ + NPC)
  js/cow/              cow.js (con bò + hoạt ảnh), cowmodel.js (model 3D + gắn xương)
  js/ui/               customize (tạo nhân vật), clan-ui, season-wheel, minimap, market-ui (quầy sữa, cửa hàng, túi đồ), admin-ui
  js/net/net.js        kết nối multiplayer, bò của người khác, bảng tên
  js/input/gamepad.js  tay cầm
  js/audio/audio.js    âm thanh tự tổng hợp
  models/cow/          model bò 3D + texture
data/                  dữ liệu khi chơi local không có MongoDB (không commit)
```

## Chơi với bạn bè

Trong game bấm nút **Mời bạn** (góc trên bên phải) để copy link.

| Cách | Khi nào | Link |
|---|---|---|
| LAN | Cùng WiFi / mạng nội bộ | `http://<IP-máy-bạn>:5173` |
| ngrok | Bạn bè ở bất kỳ đâu | `https://xxxx.ngrok-free.app` |

### Cài ngrok (làm 1 lần)

1. Đăng ký miễn phí tại https://dashboard.ngrok.com/signup
2. Cài đặt:
   ```
   winget install ngrok.ngrok
   ```
3. Gắn token (lấy tại https://dashboard.ngrok.com/get-started/your-authtoken):
   ```
   ngrok config add-authtoken <TOKEN>
   ```
4. Chạy lại `start.bat`. Link Internet hiện trong cửa sổ ngrok, cửa sổ server và nút **Mời bạn**.

### Giữ link cố định (không đổi mỗi lần chạy)

Tài khoản ngrok miễn phí có 1 domain cố định (Dashboard → **Domains**).
Tạo file `ngrok-domain.txt` cạnh `start.bat`, chỉ ghi tên domain, ví dụ:

```
ten-cua-ban.ngrok-free.app
```

### Lưu ý

- Máy bạn là server: tắt `start.bat` / server thì mọi người sẽ mất kết nối.
- Lần đầu mở link ngrok, bạn bè sẽ thấy trang cảnh báo của ngrok. Bấm **Visit Site** để vào game.
- Ai có link cũng vào được, nên chỉ gửi cho người quen. Server chỉ cho tải các file của game, tối đa 32 người, có chống spam chat.
- Nếu Windows Firewall hỏi quyền cho Node.js, chọn cho phép mạng **Private** để chơi LAN.

## Deploy lên Render (chơi qua Internet, không cần bật máy)

1. Đưa code lên một repo GitHub (xem lệnh bên dưới).
2. Vào https://dashboard.render.com, chọn **New → Blueprint**, rồi chọn repo đó.
   Render đọc `render.yaml` và tự tạo service `cow-meadow` (gói Free, đặt ở Singapore).
3. Chờ khoảng 1–2 phút là có link `https://cow-meadow-xxxx.onrender.com`.

Mỗi lần `git push` lên GitHub, Render tự deploy lại.

Gói Free sẽ "ngủ" sau khoảng 15 phút không có ai truy cập. Lần vào sau đó phải chờ khoảng 30–60 giây để server khởi động lại.

## Điều khiển

WASD/mũi tên: đi (S = lùi) · Shift: chạy · Space: nhảy · F: húc · E (giữ): gặm cỏ / uống nước · Q: kêu moo · Z: nằm nghỉ · Chuột: xoay camera · Lăn chuột: zoom ·
Enter: chat · Tab: túi đồ · G: clan · C: chế độ điện ảnh · H: hướng dẫn chơi · F3: debug · Esc: cài đặt · Ctrl+K: chỉnh tay thời tiết, giờ, mùa (admin/test)

**Tay cầm (Xbox / PlayStation / tay cầm chuẩn):** cắm vào hoặc kết nối Bluetooth rồi bấm 1 nút bất kỳ. Cần trái: đi (analog) · Cần phải: camera (R3 về sau lưng) · LB/LT: chạy · A/✕: nhảy, vào game, chơi lại · B/○: nằm, quay lại · X/□ giữ: gặm cỏ/uống · Y/△: moo · RB/RT: húc · D-pad ↑↓: zoom · D-pad ←: điện ảnh · View: clan · Menu: cài đặt. Có rung khi bị va chạm (tắt trong cài đặt).

## Thời gian, mùa & thời tiết

- Ngày/đêm chạy liên tục: **1 ngày = 15 phút** thật, đồng bộ cho mọi người theo đồng hồ server.
- **4 mùa**, mỗi mùa 2 ngày (1 năm = 2 giờ): Xuân (nhiều hoa, lá hồng bay), Hạ (nắng gắt), Thu (cỏ và cây vàng cam, lá rụng), Đông (tuyết phủ, tuyết rơi, hồ đóng băng, cá sấu ngủ đông, đói nhanh hơn).
- Thời tiết **ngẫu nhiên** mỗi 4 phút theo xác suất của từng mùa.
- Vòng tròn mùa ở góc trên bên phải: vị trí trong năm, giờ trong ngày, thời tiết hiện tại.

## Mô hình bò 3D

- Bò dùng model 3D trong `public/models/cow/` (`cow.3ds` + texture `.JPG`, nguồn archibase.net). Model không có xương nên game tự gắn xương khi tải: 4 chân (hông + gối), cổ, đầu; móng, mắt, sừng gắn cứng theo chân/đầu. Mọi động tác (đi, chạy, lùi, nhảy, húc, gặm cỏ, nằm, chết) chạy trên model này.
- Kiểu "Bò sữa" dùng nguyên texture; các màu khác nhuộm lại texture (vùng sáng = màu lông, vùng tối = màu đốm, "Trơn" = một màu).
- Đuôi của model liền với mông nên không vẫy được. Máy yếu có thể tắt "Bò 3D chi tiết" trong Esc → Cài đặt để dùng bò cũ (tải lại trang để áp dụng).

## Bản đồ

Đồng cỏ vô tận với rừng cây (cây tán tròn, thông, bạch dương), bụi rậm, bụi hoa, đá, khúc gỗ đổ, hàng rào và **hồ nước** có lau sậy, lá súng. Luôn có một hồ gần chỗ xuất phát; minimap hiện các hồ màu xanh.

## Ăn, uống

- **Giữ E** trên cỏ để gặm cỏ (tăng No bụng), đứng sát mép hồ thì **giữ E để uống nước** (tăng Nước).
- Bò lội được chỗ nước nông nhưng không đi xuống chỗ sâu.
- Thiếu nước thì bò không lớn được và sẽ gầy đi.

## Máu, cá sấu và cái chết

- **Máu** giảm dần khi No bụng hoặc Nước về 0 (cả hai cùng hết thì giảm gấp đôi, khoảng 45 giây là chết). No bụng tụt từ đầy xuống hết trong khoảng 13 phút đứng yên (5 phút nếu chạy liên tục), nước khoảng 10 phút (4 phút nếu chạy); ăn uống đủ thì máu tự hồi. Máu thấp thì viền màn hình nhấp nháy đỏ.
- **Cá sấu** sống trong mọi hồ, bình thường chỉ lộ mắt và gờ lưng. Uống nước hay đứng sát bờ quá lâu thì nó bơi tới (có cảnh báo ⚠️ và tiếng gầm) rồi lao lên đớp. Thấy cảnh báo thì chạy xa khỏi bờ!
- **Chết** (đói, khát hoặc bị cá sấu đớp) thì hiện màn hình kết thúc; bấm **Chơi lại** để bắt đầu lại từ bê con ở đồng cỏ xuất phát (giữ tên và ngoại hình).

## Level

Bò có **level 0 → 30**. Gặm cỏ (giữ E) được 1 XP/giây (chỉ khi bò còn đói — bò no thì không ăn và không được XP), uống nước 0,25 XP/giây (Lv 1 ≈ 40 giây, Lv 10 ≈ 13 phút, Lv 30 ≈ 78 phút gặm cỏ); đủ XP thì lên cấp và bò to thêm (Lv 0–9 Bê con, 10–19 Bò tơ, 20–30 Bò trưởng thành, cỡ tối đa theo "Cỡ khi lớn"). Đói hoặc khát thì mất XP và có thể tụt cấp. Server giới hạn tốc độ nhận XP nên không gian lận được.

## Tài khoản & lưu tiến trình

Ở màn hình đầu có thể **Đăng ký / Đăng nhập** (tên 3–16 ký tự không dấu, mật khẩu ≥ 6 ký tự) hoặc chơi khách (không lưu).
Server lưu level, XP, no bụng, nước, máu, vị trí, tên và ngoại hình — lưu mỗi 20 giây và ngay khi thoát. Khi không chơi thì không có gì bị trừ; vào lại là tiếp tục.
Chết thì tài khoản trở về bê con mới; nút **Đổi nhân vật** trên màn hình chết để tạo lại ngoại hình. Đăng nhập cùng tài khoản ở nơi khác sẽ ngắt kết nối nơi cũ.

Mật khẩu được băm bằng scrypt (không lưu dạng chữ thường).

### Nơi lưu dữ liệu

- **MongoDB** (khi có biến `MONGODB_URI`): database `MONGODB_DB` (mặc định `newgame`). **Bắt buộc dùng trên Render**, vì bản miễn phí xoá ổ đĩa mỗi lần khởi động lại.
- **Không có `MONGODB_URI`**: mỗi collection là một file `data/<tên>.json` (chơi local).

| Collection | Nội dung |
|---|---|
| `users` | Tài khoản đăng nhập: `username`, `password` (salt + hash scrypt), `clanId`, `createdAt`, `lastLoginAt` |
| `players` | Tiến trình chơi: `name`, `look`, `level`, `xp`, `food`, `water`, `health`, vị trí `x z h`, `updatedAt` |
| `sessions` | Phiên đăng nhập (token), tự xoá khi hết hạn 30 ngày (`expiresAt`) |
| `clans` | Clan: `name`, `tag` (không trùng), `color`, `desc`, `open`, `members` (`username`, `role`, `joinedAt`), `requests` |
| `shop_items` | Vật phẩm cửa hàng (admin thêm) |
| `transactions` | Lịch sử bán sữa / mua đồ / rớt xu khi chết |
| `settings` | Giá sữa |
| `meta` | Phiên bản cấu trúc dữ liệu |

`_id` của `users` / `players` là tên đăng nhập viết thường. Dữ liệu kiểu cũ (collection `kv` / `data/store.json`) được chuyển sang tự động ở lần chạy đầu và vẫn giữ lại làm bản sao lưu — kiểm tra xong có thể xoá.

**Chạy local với MongoDB**: tạo file `.env` (đã nằm trong `.gitignore`, không bao giờ commit):

```
MONGODB_URI=mongodb+srv://<user>:<mật khẩu>@<cluster>.mongodb.net/?appName=Cluster0
MONGODB_DB=newgame
```

`start.bat` tự đọc `.env` (`node --env-file-if-exists=.env server.js`).

**Trên Render**: Service → **Environment** → thêm `MONGODB_URI` và `MONGODB_DB` → Save.
Trong MongoDB Atlas → **Network Access** phải cho phép `0.0.0.0/0` (Render không có IP cố định).
Log server sẽ ghi `Storage ready: MongoDB (newgame)`.

## Sữa, xu và cửa hàng

1. **Sữa:** bò **Lv 20+** đang no và đủ nước (trên 40%) tự ra sữa vào bầu vú (Lv 20 ≈ 1 lít/90 giây, Lv 30 ≈ 1 lít/50 giây, tối đa 10 lít) — thanh **🥛 Sữa** trên bảng trạng thái.
2. **Vắt sữa:** vào **🐄 khu vắt sữa** — khu rào gỗ có biển (gần chỗ xuất phát, có icon trên minimap), nhấn **M** (tay cầm: D-pad →) → sữa vào bình (tối đa 3 bình × 5 lít).
3. **Bán sữa:** mang bình tới **🏪 chợ**, đứng trước **quầy thu mua sữa** nhấn **E** → nhận **🪙 xu** theo giá do admin đặt (bảng giá ở chợ).
4. **Cửa hàng:** quầy bên cạnh (nhấn **E**) bán vật phẩm admin thêm vào; đồ mua về nằm trong **🎒 Túi đồ** (phím **Tab**: sữa đang có + sản phẩm đã mua, hiện chỉ để lưu giữ). Esc → 🎁 Cửa hàng để xem trước.
5. **Chết:** mất hết sữa đang có và **rớt 50% số xu** (đồ trong túi không mất).

Mọi thứ liên quan tới xu (sữa trong bầu vú, vắt, bán, mua, mất khi chết) do server tính và kiểm tra vị trí — client không tự cộng được. Chơi khách không vắt / bán / mua được.

**Chống gian lận** (server không tin số liệu client gửi lên):
- **Vị trí:** bò không di chuyển nhanh hơn ~7 m/s được (chạy thật 5,2 m/s; có dư cho bị húc văng / mạng giật). Dịch chuyển tức thời bị kéo về vị trí server → không teleport vào khu vắt sữa hay ra chợ để vắt / bán.
- **No & nước:** chỉ tăng khi bò đang cúi đầu ăn / uống (đứng yên), không tăng nhanh hơn tốc độ ăn thật, và **không tụt nhanh hơn tốc độ đói thật** → không "xả rồi đổ đầy" để cày XP.
- **XP / level:** chỉ tăng theo lượng cỏ / nước thực sự ăn được. Client báo sai thì server gửi lại số đúng.
- **Sữa & xu:** server tự tính sữa trong bầu vú, vắt / bán / mua chỉ được ở đúng chỗ (theo vị trí server), có khoá chống mua trùng, mỗi giao dịch đều ghi vào `transactions`.
- **Cảnh báo & khóa tài khoản:** gian lận rõ ràng (dịch chuyển xa > 15 m quá mức cho phép, khai dư > 50 XP, khai no / nước cao hơn thực tế > 30%) → client hiện cảnh báo đỏ ghi rõ lý do và "Vi phạm n/3". Đủ **3 lần trong 10 phút** → khóa tài khoản, thời gian tăng dần mỗi lần: **10 phút → 1 giờ → 6 giờ → 1 ngày → 7 ngày → 30 ngày** (không đăng nhập / vào game được, có màn hình báo lý do + giờ mở khóa). Chơi khách thì bị ngắt kết nối. Lệch nhỏ do mạng chỉ bị sửa lại, không tính vi phạm. Admin xem và **mở khóa** ở Quản trị → Người chơi; lịch sử khóa lưu ở `users.banHistory`.
- Client phiên bản cũ (chưa F5 sau khi cập nhật) được yêu cầu tải lại thay vì bị tính là gian lận.
- Hành vi bất thường được ghi log server (`! suspicious …`) và hiện ở cột **⚠️ Nghi gian lận** trong Esc → 🛠️ Quản trị → 👥 Người chơi.

**Admin:** đặt biến môi trường `ADMIN_USERS` (danh sách tên đăng nhập, cách nhau dấu phẩy, ví dụ `ADMIN_USERS=trungdo`) trên Render hoặc trong `.env`; hoặc đặt `role: "admin"` cho tài khoản trong collection `users`. Admin thấy tab **Esc → 🛠️ Quản trị**: giá sữa, thêm / sửa / ẩn / xoá vật phẩm (icon, tên, mô tả, giá, số lượng, thời gian bán), lịch sử giao dịch, xu & túi đồ của người chơi. Admin tài khoản cũng dùng được /ONADMIN mà không cần mã.

Dữ liệu: `players` (`coins`, `udder`, `bottles`, `inventory`), `shop_items`, `transactions` (bán sữa, mua đồ, rớt xu khi chết), `settings` (giá sữa).

## Clan

Nhấn **G** để quản lý clan — cần đăng nhập.

- **Chưa có clan**: tạo clan (tên 3–20 ký tự, tag 2–4 chữ in hoa/số, màu, mở hoặc cần duyệt, mô tả) hoặc xin vào clan có sẵn.
- **Trong clan**: danh sách thành viên (level, online), 👑 trưởng / ⭐ phó / thành viên. Trưởng: phong/hạ phó, kick, chuyển quyền, sửa cài đặt, giải tán. Phó: duyệt đơn, kick thành viên. Trưởng rời clan thì quyền tự chuyển cho phó (hoặc người vào lâu nhất). Tối đa 20 người.
- **Đồng đội**: cùng clan húc nhau không có tác dụng. Khác clan hoặc không có clan thì mỗi cú húc mất ~7–22% máu (bò to húc đau hơn) — hết máu là chết. Server tính sát thương và giới hạn tốc độ hồi máu.
- Tên hiện tag clan có màu (**[TAG] Tên · Lv**), đồng đội hiện màu clan trên minimap. Chat riêng clan: `/c <tin nhắn>`.
- **Đối thủ** (khác clan / không clan) hiện **tên màu đỏ kèm thanh máu** trên đầu.
- **Bấm chuột vào con bò** ở gần (dưới 10 m) để xem thông tin: level, clan, tài khoản hay khách, khoảng cách, máu — trưởng/phó clan có nút **Mời vào clan** (người được mời bấm Đồng ý / Từ chối, lời mời hết hạn sau 1 phút).

## Thông báo admin

Gõ trong ô chat (Enter):

| Lệnh | Tác dụng |
|---|---|
| `/ONADMIN <nội dung>` | Hiện khung thông báo lớn cho **tất cả** người chơi (kể cả người vào sau) |
| `/OFFADMIN` | Tắt thông báo |
| `/ADMIN <mã>` | Đăng nhập admin (chỉ cần khi server có đặt `ADMIN_KEY`) |

Các lệnh này không hiện ra thành tin nhắn chat.

**Nên đặt mã admin**: code công khai trên GitHub nên ai cũng biết lệnh `/ONADMIN`. Đặt biến môi trường
`ADMIN_KEY` trên server (Render → service → **Environment** → Add `ADMIN_KEY` = mã bí mật) thì chỉ ai gõ
đúng `/ADMIN <mã>` mới bật/tắt được thông báo. Chạy local: `set ADMIN_KEY=ma-bi-mat && node server.js`.
