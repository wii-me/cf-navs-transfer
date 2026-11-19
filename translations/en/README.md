<div align="center">
  <img src="../../public/icon.png" alt="CF-Navs Transfer Icon" width="110" height="110">
  <h1>CF-Navs Transfer</h1>
  <p><strong>Enhanced Cloud-Native Start Page based on CF-Navs · Cross-Device Transfer Assistant</strong></p>
  <p>
    An enhanced fork of the open-source project <a href="https://github.com/lbjxr/CF-Navs" target="_blank"><strong>CF-Navs</strong></a>.<br>
    While preserving the elegant start page, two-level categorization, 22 built-in themes, and zero-maintenance Serverless architecture,<br>
    <strong>it integrates a cross-device, cross-platform Transfer Assistant (supporting memo notes and up to 80MB file transfers)</strong>, transforming your personal navigation into a multi-device productivity hub.
  </p>

  <p>
    <a href="https://github.com/lbjxr/CF-Navs"><img src="https://img.shields.io/badge/Based%20On-CF--Navs%20v0.9.7-0052CC?logo=bookmark&logoColor=white" alt="Based on CF-Navs v0.9.7"></a>
    <a href="../../CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v0.9.7--transfer-2ea44f?logo=git&logoColor=white" alt="Version"></a>
    <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
    <a href="https://developers.cloudflare.com/d1/"><img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1"></a>
    <a href="https://developers.cloudflare.com/kv/"><img src="https://img.shields.io/badge/Cloudflare-KV-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare KV"></a>
    <a href="https://developers.cloudflare.com/r2/"><img src="https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare R2"></a>
    <a href="https://svelte.dev/"><img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-2563EB" alt="Apache License 2.0"></a>
  </p>

  <p>
    <a href="#-recent-changelog">📢 Changelog</a> ·
    <a href="#-features-matrix">Features Matrix</a> ·
    <a href="#-transfer-assistant">Transfer Assistant</a> ·
    <a href="#️-interface-preview">Preview</a> ·
    <a href="#-quick-deployment-guide">Quick Deployment</a> ·
    <a href="#-initial-setup--usage-guide">Setup Guide</a> ·
    <a href="#️-keyboard-shortcuts">Shortcuts</a> ·
    <a href="#-faq">FAQ</a> ·
    <a href="../../CHANGELOG.md">Full Changelog</a>
  </p>

  <p>
    <a href="https://github.com/wii-me/cf-navs-transfer">
      <img src="https://img.shields.io/github/stars/wii-me/cf-navs-transfer?style=social" alt="GitHub Stars">
    </a>
    <a href="https://github.com/wii-me/cf-navs-transfer/fork">
      <img src="https://img.shields.io/github/forks/wii-me/cf-navs-transfer?style=social" alt="GitHub Forks">
    </a>
  </p>
</div>

**Languages:** [简体中文](../../README.md)

---

## 📢 Recent Changelog

> For complete commit history and details, please refer to [`CHANGELOG.md`](../../CHANGELOG.md).

<details open>
<summary><b>🔥 Latest Highlights: v0.9.7-transfer</b></summary>
<br>

* ⚡ **Transfer Assistant Core Capabilities**:
  * **Real-time Progress & Upload Speed**: Powered by XHR upload streams, dynamic progress bar, transferred/total bytes (`35.2 MB / 80.0 MB`), real-time speed (`2.4 MB/s`), and remaining ETA;
  * **Clipboard Screenshot Upload (`Ctrl+V`)**: Window-level clipboard paste listener directly streams images to Cloudflare R2 without saving local files;
  * **80MB File Transfers & Anti-Misclick Protection**: Single file limit expanded to 80MB; delete button instantly locks with a loading spinner followed by a 400ms layout shift cooldown;
  * **Anti-XSS CSP Sandbox & Auto Cleanup**: Strict CSP sandbox on download endpoints; lazy async purging of expired transfers at zero egress bandwidth cost.
* 🚀 **Upstream v0.9.1 ~ v0.9.7 Kernel Sync**:
  * **Restored Hot Bookmarks Aggregation on Empty Root Categories**: Keeps root category selected and aggregates subcategory bookmarks (#43);
  * **Instant Bookmark Edit Feedback**: Immediately shows modal shell while fetching raw fields by primary key;
  * **Quick Bookmark Creation on Empty Search**: Directly create and prefill bookmarks from empty search results in Home search or Spotlight;
  * **Delayed Collapse on Settings Menu Hover**: Gear icon triggers menu on hover with a 3-second delayed collapse;
  * **Official Docker Self-Hosting Support**: Upstream Docker containerization and Node.js SQLite server support;
  * **Browser Extension Sync & Multi-tab Session Handling**: Enhanced browser extension sync with panel session isolation.
</details>

---

## 💡 Philosophy & Background

- **The Brilliance of Original CF-Navs**: Created by [lbjxr](https://github.com/lbjxr), [CF-Navs](https://github.com/lbjxr/CF-Navs) runs on Cloudflare Workers + D1 + KV, offering a **serverless, free, and blazing-fast personal start page**.
- **The Everyday Pain Point**: When moving temporary verification codes, text snippets, screenshots, or install packages across devices (PC, Mac, mobile, tablet), users often have to rely on chat apps or third-party cloud drives.
- **The CF-Navs Transfer Solution**: By seamlessly integrating Cloudflare R2 object storage, the built-in **Transfer Assistant** can be summoned anytime with <kbd>Ctrl</kbd> + <kbd>J</kbd>. Paste screenshots directly with `Ctrl+V`, transfer up to 80MB files, preview images in lossless lightboxes, and auto-expire items. **A gorgeous start page and a handy cross-device transit hub in one place.**

---

## 📦 Features Matrix

| Category | Feature | Original CF-Navs | CF-Navs Transfer (This Fork) |
|---|---|:---:|:---:|
| **Infrastructure** | Cloudflare Workers + D1 (SQLite) + KV Edge Computing | ✅ | ✅ |
| **Object Storage** | Cloudflare R2 Object Storage (10GB free, $0 egress fee) | ❌ | ✅ **Native Integration** |
| **Productivity** | **Transfer Assistant** (Clipboard paste, notes, 80MB file transfers) | ❌ | ✅ **Built-in (<kbd>Ctrl</kbd>+<kbd>J</kbd>)** |
| **Observability** | Real-time progress bar, dynamic transfer rate (MB/s), ETA | ❌ | ✅ **Native XHR Stream** |
| **UI Safety** | Instant spinner lock on delete & 400ms layout cooldown | ❌ | ✅ **Anti-misclick Protection** |
| **Security** | Anti-XSS CSP sandbox for file downloads | ❌ | ✅ **Hardened Sandbox** |
| **Themes & UI** | 22 built-in themes, light/dark eye-care modes, frosted glass | ✅ | ✅ |
| **Spotlight** | Global spotlight search, pinyin search, quick bookmark creation | ✅ | ✅ |
| **Organization** | Two-level groups, drag-and-drop reordering, mobile categorization | ✅ | ✅ |
| **Privacy** | Complete physical isolation for private bookmarks & categories | ✅ | ✅ |
| **Icon System** | Local-first v2 cache, multiple auto-fetch icon providers | ✅ | ✅ |
| **Extension** | Chrome / Edge extension one-way sync & session isolation | ✅ | ✅ |

---

## ⚡ Transfer Assistant

```
 💻 Desktop / Terminal           ☁️ Cloudflare Global Edge CDN             📱 Mobile / Tablet
┌──────────────┐               ┌───────────────────────────────┐        ┌──────────────┐
│  Shortcut /  │  HTTPS Encrypted│  • Workers Gateway & Auth   │  Fast  │  At Your     │
│  Ctrl+V Paste├──────────────►│  • D1 Database (Metadata)     ├───────►│  Fingertips  │
│  80MB File   │               │  • R2 Object Storage (Files)  │  Direct│  Download    │
└──────────────┘               └───────────────────────────────┘        └──────────────┘
```

1. **Instant Summon (<kbd>Ctrl</kbd> + <kbd>J</kbd>)**:
   - Press <kbd>Ctrl</kbd> + <kbd>J</kbd> (or <kbd>Cmd</kbd> + <kbd>J</kbd> on macOS) anytime while logged in to toggle the drawer; mobile users can tap the top menu.
2. **Instant Screenshot Paste (`Ctrl+V`)**:
   - Paste screenshots directly from your clipboard to upload to R2 without saving local temp files.
3. **80MB File Uploads & Real-time Rate**:
   - Transfer files up to 80MB with dynamic speed reporting and abortable requests.
4. **Auto URL Hyperlinks**:
   - Memos automatically turn URLs into clickable links with strict HTML sanitization.
5. **Smart Expiration & Auto Cleanup**:
   - Set retention to 1 day, 3 days, 7 days, or permanent. Lazy purging cleans up expired files automatically without extra compute costs.

---

## 🖼️ Interface Preview

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Light Mode</strong><br><br>
      <img src="../../docs/screenshots/cf-navs-light.webp" alt="Light Homepage">
    </td>
    <td align="center" width="50%">
      <strong>Dark Mode</strong><br><br>
      <img src="../../docs/screenshots/cf-navs-dark.webp" alt="Dark Homepage">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>Responsive Mobile Layout</strong><br><br>
      <img src="../../docs/screenshots/cf-navs-light-mobile.webp" alt="Mobile Homepage" width="260">
    </td>
    <td align="center" width="50%">
      <strong>Admin Settings Panel</strong><br><br>
      <img src="../../docs/screenshots/cf-navs-admin-setting.webp" alt="Admin Settings Panel" width="400">
    </td>
  </tr>
</table>

---

## 🚀 Quick Deployment Guide

Hosted on Cloudflare's serverless edge. **Zero VPS cost, free hosting.**

### 🤖 Option 1: Automated Deployment via AI Assistant (Recommended ⭐)

> 💡 If you use **Cursor**, **Claude Code**, **Windsurf**, **GitHub Copilot**, or **Google Antigravity**, clone the repo locally and paste this prompt:

```text
Please deploy this project to my Cloudflare account:
1. Verify npx wrangler login status (guide me to login if unauthenticated);
2. Check or create D1 database (cf-navs-db), KV namespace (SESSION), and R2 bucket (cf-navs-storage);
3. Generate local wrangler.local.toml with correct bindings;
4. Generate a strong SETUP_TOKEN, write it to Cloudflare Secret, run schema.sql for D1 remote init, build and deploy;
5. Run health check, output the domain and SETUP_TOKEN, and remind me to visit /install to finish admin setup.
```

---

### 🌐 Option 2: Cloudflare Dashboard Deployment (Zero CLI)

1. **Create R2 Bucket**: In [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2** → Create bucket `cf-navs-storage`.
2. **Fork Repo**: Click **[Fork this repo](https://github.com/wii-me/cf-navs-transfer/fork)** on GitHub.
3. **Import to Workers**: Go to **Workers & Pages** → **Create** → **Select the "Workers" tab** (do NOT select Pages) and import your fork.
4. **Build Settings**: Build command: `npm run build`, Deploy command: `npx wrangler deploy`, add environment variable `NODE_VERSION` = `24`.
5. **Add Bindings**: In Worker **Settings → Bindings**, add:
   * D1 Database: variable `DB`, database `cf-navs-db`;
   * KV Namespace: variable `SESSION`, namespace `cf-navs-session`;
   * R2 Bucket: variable **`STORAGE`** (uppercase), bucket `cf-navs-storage`.
6. **Set `SETUP_TOKEN`**: In **Settings → Variables and Secrets**, add Secret `SETUP_TOKEN` with a secure random string. **Click "Retry deployment" in Deployments to apply.**
7. **Run Database Schema**: Go to **D1 SQL Database** → select database → **Console**, copy and execute the entire [`schema.sql`](../../schema.sql).
8. **Initialize at `/install`**: Visit `https://<your-worker-domain>/install`, enter `SETUP_TOKEN` and create your admin password (must be ≥12 characters).

> 📖 For step-by-step screenshots, see [Deployment Guide (DEPLOYMENT.md)](../../docs/guides/DEPLOYMENT.md).

---

### 💻 Option 3: Wrangler CLI Deployment

```bash
# 1. Clone and install dependencies
git clone https://github.com/wii-me/cf-navs-transfer.git && cd cf-navs-transfer && npm install

# 2. Login to Cloudflare and create resources
npx wrangler login
npx wrangler d1 create cf-navs-db
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create cf-navs-storage

# 3. Auto-configure and first deploy
npm run setup:wrangler && npm run deploy

# 4. Set setup token and initialize database
npx wrangler secret put SETUP_TOKEN
npm run db:init:remote

# 5. Redeploy
npm run deploy
```

> 💡 **Docker Self-Hosting Alternative**: If you prefer self-hosting on your private VPS with Docker, see [Docker Deployment Guide (DOCKER_DEPLOY.md)](../../docs/guides/DOCKER_DEPLOY.md).

---

## 🎯 Initial Setup & Usage Guide

1. **Set Admin Password (`/install`)**: Visit `https://<domain>/install`, enter `SETUP_TOKEN`, set an admin password (≥12 chars).
2. **Security Cleanup**: Delete `SETUP_TOKEN` in Worker **Settings → Variables and Secrets** after setup.
3. **Admin Login**: Access `/admin` or click the lock icon in the top right.
4. **Import Bookmarks**: Under "Data Management → Backup & Restore", import HTML bookmarks or JSON backups.
5. **Use Transfer Assistant**: Press <kbd>Ctrl</kbd> + <kbd>J</kbd> (<kbd>Cmd</kbd> + <kbd>J</kbd> on macOS) anytime.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Scope | Description |
|---|---|---|
| <kbd>Ctrl</kbd> + <kbd>J</kbd> / <kbd>Cmd</kbd> + <kbd>J</kbd> | Global | Toggle **Transfer Assistant** drawer |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>Cmd</kbd> + <kbd>K</kbd> | Global | Toggle **Spotlight Search** command palette |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> / <kbd>Cmd</kbd> + <kbd>V</kbd> | Transfer Panel | Paste text or upload screenshot directly from clipboard |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd> | Transfer Input | Submit note & attachments |
| <kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>Enter</kbd> | Spotlight Panel | Navigate and open selected bookmark |
| <kbd>Esc</kbd> | Global | Close active modal, lightbox, Spotlight, or drawer |
| <kbd>/</kbd> | Homepage | Focus search input / summon Spotlight |

---

## ❓ FAQ

<details>
<summary><b>Q1: What is the difference between this project and original CF-Navs?</b></summary>
<br>
This project is an enhanced fork of CF-Navs. It inherits the elegant serverless architecture, two-level groups, 22 themes, and privacy controls, while natively integrating Cloudflare R2 object storage to add the <b>Cross-Device Transfer Assistant</b> (clipboard paste, notes, 80MB file transfers, and anti-misclick protection).
</details>

<details>
<summary><b>Q2: Will upgrading from upstream CF-Navs cause data loss?</b></summary>
<br>
<b>Not at all.</b> The schema is 100% backward compatible. Upgrading only requires adding the R2 binding (<code>STORAGE</code>) and executing the <code>transfer_notes</code> table creation in D1.
</details>

<details>
<summary><b>Q3: Where are uploaded files stored? Are there extra costs?</b></summary>
<br>
Files are stored securely in your own Cloudflare R2 bucket. Cloudflare R2 provides <b>10GB free storage per month and $0 egress bandwidth fees</b>.
</details>

---

## 🤝 Acknowledgements & License

- 🌟 **Special Thanks**: Based on **[CF-Navs](https://github.com/lbjxr/CF-Navs)** by [@lbjxr](https://github.com/lbjxr).
- Inspired by [Sun-Panel](https://github.com/hslr-s/sun-panel) and [iori-nav](https://github.com/jy02739244/iori-nav).
- Licensed under [Apache-2.0 License](../../LICENSE). See [`NOTICE`](../../NOTICE) for copyright details.
