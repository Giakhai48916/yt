# LiteTube 🚀
### Trình Phát Video Tối Giản, Siêu Nhẹ & Sạch Bóng Quảng Cáo Dành Cho Android & iOS

<p align="center">
  <img src="https://img.shields.io/badge/Android-8.0+_(API_26+)-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/iOS_&_iPadOS-15.0+-000000?style=for-the-badge&logo=apple&logoColor=white" alt="iOS" />
  <img src="https://img.shields.io/badge/Language-Kotlin_&_Swift-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white" alt="Language" />
  <img src="https://img.shields.io/badge/Ads_Blocked-100%25_Zero_Ads-blue?style=for-the-badge" alt="Zero Ads" />
</p>

---

## 📖 Giới Thiệu Sản Phẩm

**LiteTube** là ứng dụng xem video thế hệ mới dành cho cả **Android** và **iOS / iPadOS**, được thiết kế để mang đến trải nghiệm giải trí video đỉnh cao: **Siêu mượt, Siêu nhẹ, Tiết kiệm pin tối đa và Tuyệt đối không bị làm phiền bởi bất kỳ loại quảng cáo nào**.

Thay vì phải gánh một ứng dụng chính thức cồng kềnh và ngập tràn nội dung quảng cáo tài trợ, **LiteTube** kết hợp sức mạnh tối ưu phần cứng của WebView (Chromium trên Android, WebKit trên iOS) với **ý tưởng của Brave Browser**.

---

## ✨ Tính Năng

### 🎬 1. Trình Phát Thu Nhỏ Trong App (In-App MiniPlayer 2 Tầng Độc Quyền)
* Vuốt nhẹ xuống hoặc bấm nút mũi tên để thu nhỏ video thành thanh **MiniPlayer** ở đáy màn hình, thoải mái lướt trang chủ, tìm kiếm video khác mà không bị mất vị trí cuộn.
* Điều hướng SPA siêu tốc giúp chuyển video mới gần như tức thì, chống chồng âm thanh và tối ưu mượt mà trên cả điện thoại lẫn iPad màn hình ngang.

---

### 🛡️ 2. Hệ Thống Chặn Quảng Cáo 3 Tầng (Brave Shields)
* Chặn tên miền quảng cáo ngay từ tầng mạng (`AdBlockEngine` trên Android và `WKContentRuleList` trên iOS).
* Gọt sạch dữ liệu quảng cáo InnerTube và tự động tua 16x + bỏ qua quảng cáo ghép luồng (SSAI).
* Ẩn toàn bộ banner tài trợ và hộp thoại nhắc mở ứng dụng bằng CSS Cosmetic Filtering.

---

### ⏱️ 3. Hẹn Giờ Tắt Video Tự Động (Giống Cốc Cốc)
* Tích hợp sẵn **nút đồng hồ Hẹn giờ** ngay góc trên bên phải khung video (và trong menu cài đặt bánh răng `⚙`).
* Hỗ trợ **Tự động tắt khi hết video hiện tại** (chặn tự động chuyển bài trong Mix/Playlist) hoặc hẹn giờ tắt sau **15 / 30 / 45 / 60 / 90 phút**.

---

### 📱 4. Picture-in-Picture (PiP) Mượt Mà & Phát Âm Thanh Khi Tắt Màn Hình
* **Chế độ cửa sổ nổi PiP:** Vuốt về màn hình chính (Home) để video tự động thu nhỏ thành cửa sổ nổi, khớp tỷ lệ chuẩn của video (16:9, 4:3 hoặc video dọc Shorts) và trang bị nút điều khiển native độc lập.
* **Công nghệ chống ngắt Micro-Seek:** Thoát và vào PiP liên tục mà không bị dừng hình hay kẹt nút phát/tạm dừng.
* **Phát trong nền (Background Playback):** Thoải mái nghe nhạc, podcast hoặc bài giảng khi tắt màn hình điện thoại mà âm thanh vẫn duy trì ổn định qua Foreground Service (Android) và `AVAudioSession` + `MPNowPlayingInfoCenter` (iOS).

---

### ⚙️ 5. Menu Cài Đặt Tích Hợp Native Tinh Tế
* Truy cập mục Cài đặt của ứng dụng ngay trong trang cài đặt tài khoản của YouTube (`https://m.youtube.com/select_site`).
* Cho phép bật / tắt nhanh:
  * Chặn quảng cáo (AdBlock & Tua SSAI 16x).
  * Phát âm thanh khi tắt màn hình (Background Play).
  * Tự động kích hoạt PiP khi ra màn hình chính.
  * Bộ nhớ đệm tài nguyên tĩnh (Static Cache) và 1 chạm xóa sạch cache.
  * Hẹn giờ tắt video tự động.

---

## 📥 Tải Về & Cài Đặt (Installation)

### 🤖 1. Dành Cho Điện Thoại Android (`.apk`)
#### Cách 1: Tải Bản Đóng Gói Sẵn (Khuyên dùng)
1. Đăng nhập tài khoản GitHub, truy cập mục **Releases** hoặc tab **Actions** của kho lưu trữ này.
2. Chọn lần chạy mới nhất có dấu tích xanh ✅ $\rightarrow$ kéo xuống mục **Artifacts** và tải **`LiteTube-Debug-APK`**.
3. Giải nén file `.zip`, mở file `.apk` trên điện thoại Android của bạn và chọn **Cài đặt** (nếu có thông báo, cho phép cài đặt ứng dụng từ nguồn này).
4. Mở **LiteTube** và tận hưởng trải nghiệm xem video không giới hạn!

#### Cách 2: Tự Biên Dịch Android Từ Mã Nguồn
Yêu cầu: Máy tính đã cài đặt **Java 17 (JDK 17)** và **Android SDK Platform 34**.

```bash
# Biên dịch bản Debug APK trên Windows (PowerShell):
.\gradlew.bat assembleDebug

# Trên macOS / Linux:
chmod +x ./gradlew
./gradlew assembleDebug
```
File APK đầu ra: `app/build/outputs/apk/debug/app-debug.apk`

---

### 🍎 2. Dành Cho iPhone / iPad — iOS & iPadOS (`.ipa`)
Do chính sách của Apple không cho phép cài thẳng file `.ipa` từ trình duyệt như Android, bạn tải file **`LiteTube-iOS.ipa`** từ GitHub rồi cài miễn phí qua **Sideloadly**, **AltStore**, **SideStore** hoặc **TrollStore**:

1. **Tải file `.ipa`:** Đăng nhập GitHub $\rightarrow$ vào tab **Actions** $\rightarrow$ chọn lần chạy mới nhất có tích xanh ✅ $\rightarrow$ kéo xuống mục **Artifacts** và tải **`LiteTube-iOS-IPA`**, giải nén để lấy file **`LiteTube-iOS.ipa`**.
2. **Cài đặt vào iPhone / iPad (chọn 1 trong 2 cách):**
   * **Cách A — Dùng Sideloadly trên máy tính Windows / Mac (Đơn giản nhất):**
     1. Mở phần mềm **Sideloadly**, cắm cáp nối iPhone/iPad với máy tính.
     2. Kéo thả file **`LiteTube-iOS.ipa`** vào Sideloadly, nhập Apple ID của bạn rồi bấm **Start**.
     3. Trên iPhone/iPad vào **Cài đặt $\rightarrow$ Cài đặt chung $\rightarrow$ Quản lý VPN & Thiết bị** $\rightarrow$ chọn email của bạn và bấm **Tin cậy (Trust)** (trên iOS 16+ bật thêm **Chế độ nhà phát triển** trong *Quyền riêng tư & Bảo mật*).
   * **Cách B — Cài trực tiếp trên iPhone/iPad (không cần máy tính):**
     1. Nếu máy đã có **AltStore / SideStore / ESign / Scarlet / TrollStore**, chỉ cần mở ứng dụng đó $\rightarrow$ bấm **`+`** $\rightarrow$ chọn file **`LiteTube-iOS.ipa`** để cài ngay.

---

### 📺 3. Dành Cho Android TV / Google TV (Sony, TCL, Xiaomi, Android Box) qua USB
File **`app-debug.apk`** đã tích hợp sẵn **Chế độ TV Mode (1 WebView siêu nhẹ)** và **Banner Android TV** (tự động hiện trên màn hình chính TV):
1. Tải gói **`LiteTube-Debug-APK`** từ tab **Actions** trên GitHub, giải nén lấy file **`app-debug.apk`** và chép vào USB.
2. Cắm USB vào TV Sony / TCL $\rightarrow$ mở trình quản lý tệp (**X-plore** hoặc **File Commander** tải từ CH Play trên TV) $\rightarrow$ bấm vào `app-debug.apk` để cài đặt.
3. **Điều khiển bằng Remote TV TCL / Sony:**
   * **Phím mũi tên (Lên/Xuống/Trái/Phải) + OK:** Di chuyển và chọn video y hệt YouTube TV gốc.
   * **Phím Back:** Quay lại bước trước trong YouTube TV *(nhấn Back 2 lần liên tiếp để thoát ứng dụng)*.
   * **Phím Menu / Cài đặt (Settings) / Info trên Remote:** Mở menu nhanh **LiteTube TV** để chỉnh **Hẹn giờ tắt video**, bật/tắt **Chặn quảng cáo**, hoặc **Xóa bộ nhớ đệm**.
   * **Phím Media (Play/Pause, Tua nhanh/Lùi):** Tạm dừng, phát tiếp hoặc tua nhanh ±10 giây trực tiếp.

---

## 🏗️ Kiến Trúc Kỹ Thuật (Architecture Overview)

```
┌────────────────────────────────────────────────────────┐
│            HỆ ĐIỀU HÀNH ANDROID & iOS / iPadOS         │
│      PiP Controls • Notification / Control Center      │
│      LockScreen MediaControls • Background Audio       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│          TẦNG NATIVE (KOTLIN - ANDROID / SWIFT - iOS)  │
│   • MainActivity / MainViewController: 2 Tầng View     │
│   • Layer 1 (Browse): SwipeRefresh + Browse WebView    │
│   • Layer 2 (Player): playerPanel + MiniPlayerBar      │
│   • AdBlockEngine (O(1)) / WKContentRuleList (iOS)     │
│   • WebResourceCacheManager: Non-blocking Static Cache │
│   • MediaService / MPNowPlayingInfoCenter              │
│   • AppSettings & Sleep Timer (Hẹn giờ tắt video)      │
└───────────────────────────┬────────────────────────────┘
                            │ IPC Bridge (AndroidBridge / WKScriptMessageHandler)
┌───────────────────────────▼────────────────────────────┐
│               TẦNG WEB SHIELDS (JAVASCRIPT / CSS)      │
│   • browseWatchInterceptor: Bắt click & SPA pushState  │
│   • youtube_defuser: Tua 16x SSAI, gọt sạch InnerTube  │
│   • pip_controller: Cô lập video PiP & Micro-Seek      │
│   • cosmetic_rules & iPad Responsive CSS               │
│   • selectSiteSettings: Nhét menu cài đặt vào web      │
└────────────────────────────────────────────────────────┘
```

> 📚 Xem toàn bộ tài liệu kiến trúc, hướng dẫn mã nguồn và luồng dữ liệu chuyên sâu tại [**Thư mục Tài Liệu Kỹ Thuật (`docs/`)**](./docs/README.md).

---

## 🔒 Cam Kết Quyền Riêng Tư & Bảo Mật

* **Không theo dõi (Zero Telemetry):** Ứng dụng không chứa bất kỳ SDK phân tích hành vi người dùng, theo dõi vị trí hay gửi dữ liệu về máy chủ bên thứ ba.
* **Mã nguồn mở minh bạch:** Toàn bộ mã nguồn Kotlin, Swift, JavaScript và CSS đều mở và có thể kiểm chứng độc lập.
* **Tài khoản an toàn:** Mọi thao tác đăng nhập Google (nếu bạn sử dụng) đều diễn ra trực tiếp bên trong Web Engine hệ thống (Chromium trên Android / WebKit trên iOS), thông tin tài khoản được lưu trữ an toàn trong Cookie Container của thiết bị.

---

## ⚖️ Tuyên Bố Miễn Trừ Trách Nhiệm (Disclaimer)

* **LiteTube** là một dự án phần mềm mã nguồn mở độc lập, phi thương mại phục vụ mục đích nghiên cứu công nghệ tối ưu hóa tài nguyên phần cứng di động và duyệt web an toàn.

---

<p align="center">
  Được phát triển với tâm huyết dành cho cộng đồng yêu thích sự tinh giản và tự do công nghệ. ⭐ Hãy nhấn <b>Star</b> cho dự án nếu bạn thấy hữu ích!
</p>
