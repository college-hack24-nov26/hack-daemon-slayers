#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <RTClib.h>
#include <mbedtls/md.h>
#include <qrcode_gen.h> // ricmoo's library

// --- HARDWARE & CONSTANTS CONFIGURATION ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_ADDR     0x3C

#define PIN_SDA       21
#define PIN_SCL       22
#define PIN_BUZZER    19
#define PIN_BTN       0     // BOOT button

#define INTERVAL      30L
#define IST_OFFSET    19800L

// Classroom Configuration (Change per classroom)
#define ROOM_ID       "R101"
#define ROOM_LABEL    "ROOM 101"
#define ROOM_SECRET   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" // 64-hex chars

// Objects
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
RTC_DS3231 rtc;

// QR Code setup (Version 3 = 29x29 modules, 106 bytes buffer fixed at compile-time)
QRCode qrcode;
uint8_t qrcodeBytes[106];

// State variables
enum RTCState { STATE_OK, STATE_NO_RTC, STATE_LOST, STATE_INVALID };
RTCState currentRTCState = STATE_OK;
int badReadCount = 0;
unsigned long lastStep = -1;
unsigned long lastDrawnUtc = 0;
bool rfcTestPassed = false;

// Forward declarations
void runBootAnimation();
bool runRFCTest();
RTCState readRTCData(uint32_t &utcOut);
void computeToken(uint32_t utc, char *tokenOut);
void drawPanel(uint32_t utc, int remaining);
void drawErrorScreen(const char *title, const char *l1, const char *l2, const char *l3);
void beep(int freq, int duration);

void setup() {
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  
  // Fixed SSD1306 init flag here
  if(!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    for(;;); // Halt if OLED fails
  }

  // Self-test RFC 4231 Test Case 1
  rfcTestPassed = runRFCTest();
  if(!rfcTestPassed) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(10, 25);
    display.print("HMAC FAIL");
    display.display();
    for(;;); // Halt forever
  }

  runBootAnimation();

  if(strlen(ROOM_SECRET) < 16) {
    drawErrorScreen("CONFIG ERROR", "SET SECRET IN", "CODE", "HALTED");
    for(;;);
  }

  if(!rtc.begin()) {
    currentRTCState = STATE_NO_RTC;
  }
}

void loop() {
  static unsigned long lastLoopCheck = 0;
  if(millis() - lastLoopCheck < 200) return;
  lastLoopCheck = millis();

  uint32_t currentUtc = 0;
  RTCState rawState = readRTCData(currentUtc);

  // Debounce logic for OLED/I2C bus glitches
  if (rawState != STATE_OK) {
    badReadCount++;
    if (badReadCount >= 3) {
      currentRTCState = rawState;
    }
  } else {
    badReadCount = 0;
    currentRTCState = STATE_OK;
  }

  if (currentRTCState != STATE_OK) {
    if (currentRTCState == STATE_NO_RTC) {
      drawErrorScreen("NO RTC", "DS3231 not found", "Check SDA=21 SCL=22", "and 3V3 + GND");
    } else if (currentRTCState == STATE_LOST) {
      drawErrorScreen("CLOCK LOST", "Backup battery empty", "or removed", "Upload TIMESET code");
    } else {
      drawErrorScreen("BAD CLOCK", "Time value invalid", "", "Upload TIMESET code");
    }
    beep(1000, 150);
    delay(100);
    beep(800, 150);
    return;
  }

  uint32_t step = currentUtc / INTERVAL;
  int remaining = INTERVAL - (currentUtc % INTERVAL);

  if (step != lastStep) {
    char token[32];
    computeToken(currentUtc, token);

    // Generate QR Code using ricmoo's API (Version 3, Low ECC)
    qrcode_initText(&qrcode, qrcodeBytes, 3, ECC_LOW, token);

    display.clearDisplay();
    
    // Draw QR code on left (x=3, y=3, scale=2 -> 58px)
    int qrX = 3;
    int qrY = (SCREEN_HEIGHT - (qrcode.size * 2)) / 2;
    
    for (uint8_t y = 0; y < qrcode.size; y++) {
      for (uint8_t x = 0; x < qrcode.size; x++) {
        if (qrcode_getModule(&qrcode, x, y)) {
          display.fillRect(qrX + (x * 2), qrY + (y * 2), 2, 2, SSD1306_WHITE);
        }
      }
    }

    drawPanel(currentUtc, remaining);
    display.display();
    lastStep = step;
    lastDrawnUtc = currentUtc;
  } else if (currentUtc != lastDrawnUtc) {
    // Redraw right panel only for real-time clock and progress bar updates
    display.fillRect(67, 0, SCREEN_WIDTH - 67, SCREEN_HEIGHT, SSD1306_BLACK);
    drawPanel(currentUtc, remaining);
    display.display();
    lastDrawnUtc = currentUtc;
  }
}

// --- CORE UTILITIES & PROTOCOL LOGIC ---

bool runRFCTest() {
  uint8_t key[20];
  memset(key, 0x0b, 20);
  char msg[] = "Hi There";
  uint8_t hmacResult[32];
  
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
  mbedtls_md_hmac_starts(&ctx, key, 20);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg, strlen(msg));
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  const char *expectedHex = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
  char hexBuffer[65];
  for(int i=0; i<32; i++) {
    sprintf(&hexBuffer[i*2], "%02x", hmacResult[i]);
  }
  return (strcmp(hexBuffer, expectedHex) == 0);
}

RTCState readRTCData(uint32_t &utcOut) {
  Wire.beginTransmission(0x68);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return STATE_NO_RTC;

  Wire.requestFrom(0x68, 16);
  if (Wire.available() < 16) return STATE_NO_RTC;

  uint8_t regs[16];
  for (int i = 0; i < 16; i++) regs[i] = Wire.read();

  if (regs[0x0F] & 0x80) return STATE_LOST;

  int sec = (regs[0] & 0x7F); sec = (sec >> 4) * 10 + (sec & 0x0F);
  int mi  = (regs[1] & 0x7F); mi  = (mi >> 4) * 10 + (mi & 0x0F);
  int hr;
  if (regs[2] & 0x40) {
    int h12 = (regs[2] & 0x1F);
    h12 = (h12 >> 4) * 10 + (h12 & 0x0F);
    hr = (regs[2] & 0x20) ? (h12 == 12 ? 12 : h12 + 12) : (h12 == 12 ? 0 : h12);
  } else {
    hr = (regs[2] & 0x3F);
    hr = (hr >> 4) * 10 + (hr & 0x0F);
  }
  int day = (regs[4] & 0x3F); day = (day >> 4) * 10 + (day & 0x0F);
  int month = (regs[5] & 0x1F); month = (month >> 4) * 10 + (month & 0x0F);
  int year = 2000 + ((regs[6] >> 4) * 10 + (regs[6] & 0x0F));

  if (year < 2026 || year > 2099 || month < 1 || month > 12 || hr > 23 || mi > 59 || sec > 59) return STATE_INVALID;

  int daysInMonths[] = {0, 31, (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (day < 1 || day > daysInMonths[month]) return STATE_INVALID;

  auto daysFromCivil = [](int y, int m, int d) {
    y -= m <= 2;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int>(doe) - 719468;
  };

  utcOut = (uint32_t)daysFromCivil(year, month, day) * 86400L + hr * 3600L + mi * 60L + sec;
  return STATE_OK;
}

void computeToken(uint32_t utc, char *tokenOut) {
  uint32_t step = utc / INTERVAL;
  char msg[32];
  sprintf(msg, "%s:%lu", ROOM_ID, step);

  uint8_t key[32];
  for (int i = 0; i < 32; i++) {
    char byteStr[3] = { ROOM_SECRET[i*2], ROOM_SECRET[i*2+1], '\0' };
    key[i] = (uint8_t)strtol(byteStr, NULL, 16);
  }

  uint8_t hmac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, key, 32);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg, strlen(msg));
  mbedtls_md_hmac_finish(&ctx, hmac);
  mbedtls_md_free(&ctx);

  // Clamp offset to max 24 so we can safely read 8 bytes without overflowing the 32-byte HMAC array
  uint8_t off = hmac[31] % 24; 

  // Pack 8 bytes into a 64-bit integer to support 12 base-36 digits
  uint64_t bin64 = 0;
  bin64 |= (uint64_t)(hmac[off] & 0x7F) << 56;
  bin64 |= (uint64_t)(hmac[off+1])      << 48;
  bin64 |= (uint64_t)(hmac[off+2])      << 40;
  bin64 |= (uint64_t)(hmac[off+3])      << 32;
  bin64 |= (uint64_t)(hmac[off+4])      << 24;
  bin64 |= (uint64_t)(hmac[off+5])      << 16;
  bin64 |= (uint64_t)(hmac[off+6])      << 8;
  bin64 |= (uint64_t)(hmac[off+7]);

  int max_length = 12;
  char b36[max_length + 1];
  b36[max_length] = '\0';
  for (int i = max_length - 1; i >= 0; i--) {
    uint32_t rem = bin64 % 36;
    bin64 /= 36;
    b36[i] = (rem < 10) ? ('0' + rem) : ('A' + (rem - 10));
  }

  sprintf(tokenOut, "%s:%s", b36, ROOM_ID);
}

void drawPanel(uint32_t utc, int remaining) {
  uint32_t istUtc = utc + IST_OFFSET;
  unsigned long daySec = istUtc % 86400L; // Fixed back to istUtc so time reflects IST
  int hr = daySec / 3600;
  int mi = (daySec % 3600) / 60;
  int sc = daySec % 60;
  int clock_alignment_x = 104;

  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Room Label
  display.setCursor(67, 0);
  display.print(ROOM_LABEL);

  // Separator Line
  display.drawFastHLine(67, 9, 61, SSD1306_WHITE);

  // Time Display in 2x2 Layout (Hours stacked above Minutes, size 2)
  display.setTextSize(2);
  
  char hrStr[3];
  char miStr[3];
  sprintf(hrStr, "%02d", hr);
  sprintf(miStr, "%02d", mi);

  // Top row: Hours (flashing colon indicator or clean stacked block)
  display.setCursor(clock_alignment_x, 13);
  display.print(hrStr);
  
  // Blinking dot / separator or label indicator between rows if desired, 
  // or place Minutes right below on row 2 (y=31)
  display.setCursor(clock_alignment_x, 31);
  display.print(miStr);

  display.setTextSize(1);

  // Progress Bar
  display.drawRect(67, 55, 61, 8, SSD1306_WHITE);
  int innerWidth = (57 * remaining) / INTERVAL;
  if (innerWidth > 0) {
    display.fillRect(69, 57, innerWidth, 4, SSD1306_WHITE);
  }
}

void drawErrorScreen(const char *title, const char *l1, const char *l2, const char *l3) {
  display.clearDisplay();
  display.fillRect(0, 0, SCREEN_WIDTH, 12, SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(4, 2);
  display.print(title);

  display.setTextColor(SSD1306_WHITE);
  display.setCursor(4, 18);
  display.print(l1);
  display.setCursor(4, 30);
  display.print(l2);
  display.setCursor(4, 42);
  display.print(l3);
  display.display();
}


void runBootAnimation() {
  for (int r = 2; r <= 76; r += 4) {
    display.clearDisplay();
    display.drawCircle(SCREEN_WIDTH/2, SCREEN_HEIGHT/2, r, SSD1306_WHITE);
    if (r > 16) display.drawCircle(SCREEN_WIDTH/2, SCREEN_HEIGHT/2, r - 16, SSD1306_WHITE);
    if (r > 32) display.drawCircle(SCREEN_WIDTH/2, SCREEN_HEIGHT/2, r - 32, SSD1306_WHITE);
    display.display();
    delay(10);
  }

  for (int x = 0; x < SCREEN_WIDTH; x += 6) {
    display.clearDisplay();
    display.setTextSize(3);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(15, 20);
    display.print("SANeX");
    display.fillRect(x, 0, SCREEN_WIDTH - x, SCREEN_HEIGHT, SSD1306_BLACK);
    display.drawFastVLine(x, 0, SCREEN_HEIGHT, SSD1306_WHITE);
    display.display();
    delay(15);
  }
  delay(300);
}

void beep(int freq, int duration) {
  tone(PIN_BUZZER, freq, duration);
  delay(duration);
  noTone(PIN_BUZZER);
}