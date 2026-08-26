# SHARRI Restaurant — Ordering & POS Platform

> A dark-luxury restaurant website with a complete ordering flow, kitchen display,
> admin panel, cash-register reporting and scannable QR receipts.
> **100% static. Zero dependencies. No build step.**

---

🌐 Live Demo
https://diamantmuqici-dotcom.github.io/SharriResturant/

## ✨ Features

### ️ Customer
- Luxury dark/gold UI with animated hero, menu, search, category filters and sorting
- Product cards with badges (Popullore, Specialitet, Ditor, Për Familje)
- Cart drawer with quantities, per-item notes, VAT breakdown
- Checkout with dine-in / takeaway, table number and kitchen notes
- Printable receipt with **QR code**

### 👨‍ Kitchen (`#/kitchen`)
- Live order board (Preparing / Ready / Completed / Cancelled)
- Sound notification for new orders
- One-tap status updates and receipt reprint

### 🛡️ Admin (`#/admin`)
- Secure login with rate limiting (5 attempts → 5-minute lockout)
- Dashboard: orders today, revenue, average order, top products
- Order management: search, filter, status change, CSV export
- Product management: add / edit / hide / delete, image upload with client-side compression
- **Raporti i Arkës** (cash register): coins, banknotes, withdrawals, expected total, difference, history, print
- Full **audit log**: who logged in, when, what was created / updated / cancelled / deleted, with reason ("arsyeja") for destructive actions, plus device ID and network profile
- Settings: restaurant info, currency, VAT

### 📱 QR Receipts
- Every receipt prints a QR code
- Scanning it opens `recepit.html` showing **only that order** — items, totals, VAT, table, date — in the same SHARRI style
- Order data travels inside the URL itself, so it works on any phone, anywhere, with no backend
