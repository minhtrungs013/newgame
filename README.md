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

WASD/mũi tên: đi · Shift: chạy · Space: nhảy · F: húc · E: kêu moo / gặm cỏ · Chuột: xoay camera · Lăn chuột: zoom ·
Enter: chat · C: chế độ điện ảnh · F3: debug
