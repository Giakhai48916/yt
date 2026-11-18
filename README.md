# LiteTube 🚀
### Trình Phát Video Tối Giản, Siêu Nhẹ & Sạch Bóng Quảng Cáo Dành Cho Android & iOS

<p align="center">
  <img src="https://img.shields.io/badge/Android-8.0+_(API_26+)-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/iOS-15.0+_(iPhone_&_iPad)-000000?style=for-the-badge&logo=apple&logoColor=white" alt="iOS" />
  <img src="https://img.shields.io/badge/Kotlin_&_Swift-Native-7F52FF?style=for-the-badge" alt="Native" />
  <img src="https://img.shields.io/badge/Ads_Blocked-100%25_Zero_Ads-blue?style=for-the-badge" alt="Zero Ads" />
</p>

## 📖 Giới Thiệu Sản Phẩm

**LiteTube** là ứng dụng xem video thế hệ mới trên cả **Android** và **iOS**, mang đến trải nghiệm giải trí đỉnh cao: **Siêu mượt, Siêu nhẹ, Tiết kiệm pin tối đa và Tuyệt đối không bị làm phiền bởi bất kỳ loại quảng cáo nào**.

## ✨ Tính Năng Nổi Bật (Đồng Bộ Trên Cả Android & iOS)

1. **Trình Phát Thu Nhỏ Trong App (In-App MiniPlayer 2 Tầng Độc Quyền):** Vuốt nhẹ xuống để thu nhỏ video về thanh MiniPlayer ở đáy màn hình, thoải mái lướt trang chủ hoặc tìm kiếm video khác mà không mất vị trí cuộn.
2. **Hẹn Giờ Tắt Video Tự Động (Giống Cốc Cốc):** Nút **Hẹn giờ (⏱️)** đặt ngay góc trên bên phải khung video (và trong menu cài đặt bánh răng `⚙`), hỗ trợ **Tự tắt khi hết video hiện tại** (chặn tự động chuyển bài trong Mix/Playlist) hoặc hẹn giờ tắt sau **15 / 30 / 45 / 60 / 90 phút**.
3. **Hệ Thống Chặn Quảng Cáo 3 Tầng (Brave Shields):** Chặn domain quảng cáo từ tầng mạng (`AdBlockEngine` / `WKContentRuleList`), gọt sạch JSON InnerTube và tự động tua 16x quảng cáo ghép luồng SSAI.
4. **Picture-in-Picture (PiP) & Phát Âm Thanh Khi Tắt Màn Hình:** Hỗ trợ cửa sổ nổi PiP và nghe nhạc nền khi khóa màn hình kèm điều khiển từ LockScreen / Control Center / Tai nghe Bluetooth.

## 📥 Tải Về & Cài Đặt (Download & Installation)

### 🤖 1. Dành Cho Điện Thoại Android (`.apk`)
1. Đăng nhập tài khoản GitHub, truy cập tab [**Actions**](../../actions) của kho lưu trữ này.
2. Chọn lần chạy mới nhất có dấu tích xanh ✅ $\rightarrow$ kéo xuống mục **Artifacts**.
3. Bấm tải **`LiteTube-Debug-APK`**, giải nén file `.zip` để lấy file **`app-debug.apk`**.
4. Mở file `.apk` trên điện thoại Android và chọn **Cài đặt**.

### 🍎 2. Dành Cho iPhone / iPad — iOS (`.ipa`)
Do chính sách của Apple không cho phép cài thẳng file từ trình duyệt như Android, file **`LiteTube-iOS.ipa`** cần được cài vào iPhone/iPad thông qua công cụ ký ứng dụng miễn phí (**Sideloadly**, **AltStore**, hoặc **TrollStore**):

#### Bước 1: Tải file `LiteTube-iOS.ipa` từ GitHub
1. Truy cập tab [**Actions**](../../actions) trên GitHub $\rightarrow$ bấm vào lần chạy có dấu tích xanh ✅.
2. Kéo xuống cuối trang mục **Artifacts** $\rightarrow$ bấm tải **`LiteTube-iOS-IPA`**.
3. Giải nén file `.zip` vừa tải về sẽ được file **`LiteTube-iOS.ipa`**.

#### Bước 2: Cài đặt file `.ipa` vào iPhone / iPad (Chọn 1 trong 3 cách)
* **Cách A — Dùng Sideloadly trên máy tính Windows / Mac (Đơn giản & phổ biến nhất):**
  1. Tải và mở phần mềm miễn phí **Sideloadly** trên máy tính, cắm cáp nối iPhone/iPad vào máy tính.
  2. Kéo thả file **`LiteTube-iOS.ipa`** vào ô IPA của Sideloadly, nhập Apple ID bất kỳ của bạn rồi bấm **Start**.
  3. Sau khi cài xong, trên iPhone vào **Cài đặt (Settings) $\rightarrow$ Cài đặt chung (General) $\rightarrow$ Quản lý VPN & Thiết bị (VPN & Device Management)** $\rightarrow$ chọn email của bạn và bấm **Tin cậy (Trust)**.
  4. Trên iOS 16 trở lên, bật thêm **Chế độ nhà phát triển (Developer Mode)** trong *Cài đặt $\rightarrow$ Quyền riêng tư & Bảo mật*.
* **Cách B — Dùng AltStore / SideStore ngay trên iPhone:**
  1. Mở ứng dụng **AltStore** hoặc **SideStore** trên iPhone $\rightarrow$ chuyển sang tab **My Apps**.
  2. Bấm dấu **`+`** ở góc trên bên trái $\rightarrow$ chọn file **`LiteTube-iOS.ipa`** để cài đặt.
* **Cách C — Dùng ESign / Feather / Scarlet / TrollStore (Không cần máy tính):**
  1. Mở công cụ ký trên iPhone của bạn, nhập file **`LiteTube-iOS.ipa`** và bấm **Sign & Install**.

## 🛠️ Tự Biên Dịch Từ Mã Nguồn (Dành cho Lập trình viên)

```bash
# 1. Biên dịch bản Android (.apk):
chmod +x ./gradlew
./gradlew assembleDebug

# 2. Biên dịch bản iOS (.ipa) trên macOS có Xcode:
cd ios
brew install xcodegen
xcodegen generate
xcodebuild clean build -project LiteTube.xcodeproj -scheme LiteTube -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO
```
