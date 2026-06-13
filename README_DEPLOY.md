# TJC ELECTRIC Cost Price Stock Web App - Deploy

แอปนี้เป็น static web app ใช้ไฟล์ `index.html`, `src/styles.css`, และ `src/app.js` โดยไม่ต้อง build.

## วิธีเร็วสุด: Netlify Drop

1. เข้า https://app.netlify.com/drop
2. ลากโฟลเดอร์ `TJC ELECTRIC ต้นทุนสินค้า-ราคา และ สต็อก` หรือไฟล์ zip ที่เตรียมไว้ขึ้นไป
3. Netlify จะสร้าง URL ให้ทันที
4. ส่ง URL นั้นให้คนอื่นใช้งานได้

## Vercel

1. สร้าง project ใหม่ใน Vercel
2. เลือกโฟลเดอร์นี้เป็น root
3. Framework preset: Other
4. Build command: เว้นว่าง
5. Output directory: `.`

## GitHub Pages

1. อัปโหลดไฟล์ในโฟลเดอร์นี้เข้า GitHub repository
2. เปิด Settings > Pages
3. เลือก deploy from branch
4. เลือก branch และ root folder

## หมายเหตุ

- ข้อมูลเก็บใน browser ด้วย `localStorage` เป็น fallback
- ถ้าต้องการให้หลายคนเห็นข้อมูลชุดเดียวกันแบบ realtime ให้สร้าง Supabase project แล้วรันไฟล์ `supabase-schema.sql`
- ในแอป กด `Cloud Sync` แล้วกรอก Supabase URL, anon public key และ Workspace ID เดียวกันทุกเครื่อง
- ระบบ Cloud ตอนนี้ใช้ Supabase Auth แบบ Magic Link ผ่านอีเมล และอนุญาตเฉพาะอีเมลที่อยู่ในตาราง `authorized_emails`
- เพิ่มอีเมลที่อนุญาตใน Supabase SQL Editor หรือ Table Editor ก่อนใช้งานจริง
- ถ้าใช้งานบน GitHub Pages ให้เพิ่ม Redirect URL ของ Auth เป็น `https://thanachirachotabout.github.io/tjc-electric-cost-price-stock/`
- ถ้าจะทดสอบบนเครื่อง ให้เพิ่ม Redirect URL ตามโดเมนที่เปิดเว็บอยู่ เช่น `http://localhost:4174/`
- ถ้าต้องการให้ทุกคนไม่ต้องกรอก Cloud Sync ให้แก้ไฟล์ `src/cloud-config.js`:

```js
window.TJC_ELECTRIC_CLOUD_CONFIG = {
  enabled: true,
  supabaseUrl: "https://xxxxx.supabase.co",
  anonKey: "sb_publishable_xxxxx",
  workspaceId: "tjc-electric-main",
  authRedirectUrl: "https://your-github-pages-url/",
  lockSettings: true
};
```

- การอ่าน Excel ใช้ SheetJS จาก CDN ดังนั้นเครื่องผู้ใช้ต้องต่อ internet ตอนใช้งาน
