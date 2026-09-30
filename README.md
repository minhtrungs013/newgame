# Cow Meadow 🐄

Game 3D thế giới mở: dắt bò đi dạo trên đồng cỏ, chơi nhiều người trong cùng một map.

## Chạy game

Cần [Node.js](https://nodejs.org). Không cần `npm install`.

Bấm đúp **`start.bat`**. File này sẽ:
1. bật server game (`node server.js`) ở cổng 5173
2. mở trình duyệt vào `http://localhost:5173`
3. nếu máy có ngrok thì mở tunnel ra Internet

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
Enter: chat · C: chế độ điện ảnh · F3: debug · Esc: cài đặt · Ctrl+K: chỉnh tay thời tiết, giờ, mùa (admin/test)

## Thời gian, mùa & thời tiết

- Ngày/đêm chạy liên tục: **1 ngày = 15 phút** thật, đồng bộ cho mọi người theo đồng hồ server.
- **4 mùa**, mỗi mùa 2 ngày (1 năm = 2 giờ): Xuân (nhiều hoa, lá hồng bay), Hạ (nắng gắt), Thu (cỏ và cây vàng cam, lá rụng), Đông (tuyết phủ, tuyết rơi, hồ đóng băng, cá sấu ngủ đông, đói nhanh hơn).
- Thời tiết **ngẫu nhiên** mỗi 4 phút theo xác suất của từng mùa.
- Vòng tròn mùa ở góc trên bên phải: vị trí trong năm, giờ trong ngày, thời tiết hiện tại.

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

Bò có **level 0 → 30**. Gặm cỏ (giữ E) được 1 XP/giây, uống nước 0,25 XP/giây (Lv 1 ≈ 40 giây, Lv 10 ≈ 13 phút, Lv 30 ≈ 78 phút gặm cỏ); đủ XP thì lên cấp và bò to thêm (Lv 0–9 Bê con, 10–19 Bò tơ, 20–30 Bò trưởng thành, cỡ tối đa theo "Cỡ khi lớn"). Đói hoặc khát thì mất XP và có thể tụt cấp. Server giới hạn tốc độ nhận XP nên không gian lận được.

## Tài khoản & lưu tiến trình

Ở màn hình đầu có thể **Đăng ký / Đăng nhập** (tên 3–16 ký tự không dấu, mật khẩu ≥ 6 ký tự) hoặc chơi khách (không lưu).
Server lưu level, XP, no bụng, nước, máu, vị trí, tên và ngoại hình — lưu mỗi 20 giây và ngay khi thoát. Khi không chơi thì không có gì bị trừ; vào lại là tiếp tục.
Chết thì tài khoản trở về bê con mới; nút **Đổi nhân vật** trên màn hình chết để tạo lại ngoại hình. Đăng nhập cùng tài khoản ở nơi khác sẽ ngắt kết nối nơi cũ.

Mật khẩu được băm bằng scrypt (không lưu dạng chữ thường).

### Nơi lưu dữ liệu

- **MongoDB** (khi có biến `MONGODB_URI`): collection `kv` trong database `MONGODB_DB` (mặc định `newgame`). **Bắt buộc dùng trên Render**, vì bản miễn phí xoá ổ đĩa mỗi lần khởi động lại.
- **Không có `MONGODB_URI`**: lưu vào file `data/store.json` (chơi local).

**Chạy local với MongoDB**: tạo file `.env` (đã nằm trong `.gitignore`, không bao giờ commit):

```
MONGODB_URI=mongodb+srv://<user>:<mật khẩu>@<cluster>.mongodb.net/?appName=Cluster0
MONGODB_DB=newgame
```

`start.bat` tự đọc `.env` (`node --env-file-if-exists=.env server.js`).

**Trên Render**: Service → **Environment** → thêm `MONGODB_URI` và `MONGODB_DB` → Save.
Trong MongoDB Atlas → **Network Access** phải cho phép `0.0.0.0/0` (Render không có IP cố định).
Log server sẽ ghi `Storage ready: MongoDB (newgame)`.

## Clan

Nhấn **G** (hoặc Esc → tab **Clan**) để quản lý clan — cần đăng nhập.

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
