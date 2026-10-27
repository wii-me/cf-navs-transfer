
    (function () {
      "use strict";

      var STORAGE_KEY = "cf-navs:guide-seen";
      var currentStep = 0;
      var currentLang = "zh";
      var animSeed = 0;
      var guideConfig = window.__CF_NAVS_GUIDE_CONFIG__ || null;
      var appearanceParams = new URLSearchParams(window.location.search);
      var isEmbedded = Boolean(guideConfig && guideConfig.embedded) ||
        (appearanceParams.get("embedded") === "1" && window.parent !== window);
      var currentCardStyle = "info";

      function applyGuideAppearance() {
        var root = document.documentElement;
        var backdrop = document.getElementById("guideBackdrop");
        var guideRoot = document.getElementById("guideRoot");
        var themeValue = guideConfig ? guideConfig.theme : appearanceParams.get("theme");
        var cardStyleValue = guideConfig ? guideConfig.cardStyle : appearanceParams.get("cardStyle");
        var theme = themeValue === "dark" ? "dark" : "light";
        var cardStyle = cardStyleValue === "icon" ? "icon" : "info";
        var accent = guideConfig ? guideConfig.accentColor || "" : appearanceParams.get("accent") || "";

        currentCardStyle = cardStyle;
        root.setAttribute("data-guide-theme", theme);
        if (backdrop) backdrop.setAttribute("data-theme", theme);
        if (guideRoot) guideRoot.setAttribute("data-card-style", cardStyle);
        if (/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(accent)) {
          if (backdrop) backdrop.style.setProperty("--accent", accent);
        }
      }

      function applyGuideSvgTheme(svg) {
        return svg
          .replace(/(<text\b[^>]*\bfill=")#3d7a52("\s*[^>]*>)/g, "$1var(--accent-strong)$2")
          .replaceAll("#3d7a52", "var(--accent)")
          .replaceAll("#235334", "var(--accent-strong)")
          .replaceAll("#d7e4d3", "var(--stage-bg)")
          .replaceAll("#e6f2ea", "var(--accent-soft)")
          .replaceAll("rgba(61,122,82,0.16)", "var(--accent-soft)")
          .replaceAll("rgba(61,122,82,0.35)", "var(--accent-glow)");
      }

      // Six guide steps, with the examples kept separate from live account data.
      var stepsData = [
        {
          num: 1,
          zh: {
            title: "搜索，一触即达",
            desc: "在顶部搜索框输入关键词，即时过滤分类与书签；左侧下拉框可切换已配置的搜索引擎，点击右侧“搜索”直达外部引擎。",
            tip: "实测细节：输入关键词时自动显示 × 清空按钮，下方实时提示“当前内容 匹配 X 个分类, Y 个站点”。"
          },
          en: {
            title: "Search & Filter Instantly",
            desc: "Type in the top search bar to filter categories and bookmarks on the fly, or choose from the search engines configured on the left.",
            tip: "Detail: Shows a clear (×) button while typing and a live 'Matched X categories, Y sites' counter right below."
          }
        },
        {
          num: 2,
          zh: {
            title: "分类浏览与二级子分类切换",
            desc: "点击顶部（或左侧）一级分类快速定位；带有 ▼ 的分类支持展开二级子分类胶囊（如 Ai服务 → ai子分类），横向点击即可切换组内书签。",
            tip: "实测细节：当前激活的一级分类带有醒目的橙红色竖条标识，每个分类旁均显示站点数量统计。"
          },
          en: {
            title: "Category Bar & Subcategory Tabs",
            desc: "Click any primary category to filter. Categories with ▼ expand into horizontal secondary tags (e.g. Ai服务 → ai子分类) for quick switching.",
            tip: "Detail: The active category pill features an orange-red vertical accent bar and displays its bookmark count."
          }
        },
        {
          num: 3,
          zh: {
            title: "书签卡片与右键“编辑”",
            desc: "左键点击卡片直接打开目标网站；右键点击卡片弹出“编辑”菜单，管理员可在弹窗中修改所属分类、设为私密链接、切换 4 种图标源或删除。",
            tip: "实测细节：编辑弹窗支持 Favicon.im、文字图标、Google、Iconify 四种图标源，以及描述“始终显示 / 悬停显示 / 隐藏”。"
          },
          en: {
            title: "Bookmark Cards & Right-Click Edit",
            desc: "Left-click a card to open the site. Right-click to open the 'Edit' menu, where admins can move categories, set Private Link, change icons, or delete.",
            tip: "Detail: Supports 4 icon sources (Favicon.im, Text, Google, Iconify) and configurable description display policies."
          }
        },
        {
          num: 4,
          zh: {
            title: "Spotlight 全局快捷搜索",
            desc: "任何时候按下 Ctrl+K（Mac 为 ⌘K）或 / 键，即可唤起居中 Spotlight 搜索面板，用 ↑ ↓ 方向键选择、Enter 键秒级打开。",
            tip: "实测细节：Spotlight 右上角可一键切换“常用书签”，每条结果右侧均显示完整分类路径（如 Ai服务 / ai子分类）。"
          },
          en: {
            title: "Global Spotlight Search (Ctrl+K)",
            desc: "Press Ctrl+K (⌘K on Mac) or / anywhere to summon the Spotlight dialog. Use ↑ ↓ arrow keys to select and Enter to launch.",
            tip: "Detail: Includes a 'Frequent Bookmarks' pill at top-right and displays full category paths on every row."
          }
        },
        {
          num: 5,
          zh: {
            title: "个性化设置与实时预览",
            desc: "在设置面板的 7 大选项卡中配置 22 套内置主题（13 套毛玻璃 + 9 套护眼纯色）、切换“详情/极简”卡片风格与“顶部/左侧”导航布局。",
            tip: "实测细节：修改外观、背景遮罩或“经常访问”展示数量后，可在保存前通过实时预览直接检查未保存效果。"
          },
          en: {
            title: "Personalization & Live Preview",
            desc: "Configure 22 built-in themes (13 Glassmorphism + 9 Eye-Care solid), card styles (Detailed vs Minimal), and nav position across 7 settings tabs.",
            tip: "Detail: Preview unsaved theme, layout, and 'Frequently Visited' changes in real time before saving."
          }
        },
        {
          num: 6,
          zh: {
            title: "开始使用吧！右上角随时回看",
            desc: "点击右上角 ⋮ 展开操作菜单：？ 打开使用指南，A 切换主题，⚙ 进入管理员登录或管理后台。登录后可查看 Top 20 访问统计与书签导入。",
            tip: "实测细节：关闭本窗口即自动记录已读（不再重复弹出），忘记操作时随时点右上角 ？ 图标回看。"
          },
          en: {
            title: "You're All Set! Revisit Anytime",
            desc: "Click the top-right ⋮ menu to reveal the ? Guide, A theme toggle, and ⚙ admin entry. After login, the admin panel includes Top 20 analytics and bookmark import.",
            tip: "Detail: Closing this modal marks the guide as seen. Tap the top-right ? icon anytime to review."
          }
        }
      ];

      // Reusable SVG Cursor + Click Ripples
      function renderCursorGroup(cursorClass, r1Class, r2Class, r1Cx, r1Cy, r2Cx, r2Cy) {
        var ripples = "";
        if (r1Class) {
          ripples += '<circle class="' + r1Class + '" cx="' + r1Cx + '" cy="' + r1Cy + '" r="4" fill="none" stroke="#e85d3f" stroke-width="2.5" />';
        }
        if (r2Class) {
          ripples += '<circle class="' + r2Class + '" cx="' + r2Cx + '" cy="' + r2Cy + '" r="4" fill="none" stroke="#3d7a52" stroke-width="2.5" />';
        }
        return (
          ripples +
          '<g class="' + cursorClass + '" style="pointer-events:none; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.28));">' +
            '<path d="M0,0 L0,20 L5.2,15.5 L9.2,24 L12.5,22.5 L8.5,14 L15,14 Z" fill="#1e293b" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round" />' +
          '</g>'
        );
      }

      // Build Animated SVG for Each Step — Visually Verified & 100% Bilingual
      function getStepSvg(stepIndex, lang) {
        var isEn = lang === "en";
        var detailCardActive = currentCardStyle === "info";
        var iconCardActive = currentCardStyle === "icon";

        if (stepIndex === 0) {
          // STEP 1: HomeHeroSearch — Clean search input, right engine callout, live match count, always-visible cards
          return (
            '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Top Search Bar and Instant Filter" : "顶部搜索框与实时匹配过滤示意图") + '">' +
              '<rect width="760" height="330" rx="14" fill="#d7e4d3" />' +

              /* Mini Browser Header */
              '<rect x="20" y="14" width="720" height="28" rx="8" fill="rgba(255,255,255,0.72)" />' +
              '<circle cx="36" cy="28" r="4.5" fill="#ef4444"/><circle cx="50" cy="28" r="4.5" fill="#f59e0b"/><circle cx="64" cy="28" r="4.5" fill="#22c55e"/>' +
              '<text x="380" y="32" text-anchor="middle" font-size="11" fill="#4e6151" font-weight="600">' + (isEn ? "CF-Navs 示例站点 — CF-Navs (Eye-Care Theme)" : "CF-Navs 示例站点 — CF-Navs（护眼主题）") + '</text>' +

              /* Hero Title */
              '<text x="330" y="68" text-anchor="middle" font-size="17" font-weight="700" fill="#1f2d22">' + (isEn ? "CF-Navs (Eye-Care Theme)" : "CF-Navs（护眼主题）") + '</text>' +

              /* Step 1 Number Badge + Arrow pointing to Search Box */
              '<circle cx="48" cy="105" r="15" fill="#e85d3f" />' +
              '<text x="48" y="110" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">1</text>' +
              '<path d="M67,105 L88,105" stroke="#e85d3f" stroke-width="2.2" stroke-linecap="round" />' +
              '<polygon points="93,105 85,101 85,109" fill="#e85d3f" />' +

              /* Main Search Bar Container (x=98..568, y=82..128) */
              '<rect x="98" y="82" width="470" height="46" rx="13" fill="#ffffff" stroke="#3d7a52" stroke-width="2" />' +

              /* Left Search Engine Selector Button */
              '<rect x="106" y="89" width="118" height="32" rx="9" fill="#e6f1e8" stroke="#b9d1be" stroke-width="1" />' +
              '<circle cx="122" cy="105" r="7" fill="#de5833" />' +
              '<text x="122" y="109" text-anchor="middle" font-size="9" font-weight="800" fill="#fff">D</text>' +
              '<text x="134" y="109" font-size="11.5" font-weight="700" fill="#1f2d22">Google ▾</text>' +

              /* Search Keyword Input Area (Clean typed keyword + caret) */
              '<text x="238" y="110" font-size="14" font-weight="700" fill="#1f2d22">NodeLoc</text>' +
              '<line x1="297" y1="95" x2="297" y2="115" stroke="#3d7a52" stroke-width="2" />' +

              /* Clear (×) Button + Search Submit Button */
              '<circle cx="484" cy="105" r="9" fill="#edf3ee" />' +
              '<text x="484" y="109" text-anchor="middle" font-size="12" font-weight="700" fill="#5a6d5d">×</text>' +
              '<rect x="502" y="89" width="58" height="32" rx="9" fill="#3d7a52" />' +
              '<text x="531" y="109" text-anchor="middle" font-size="12" font-weight="700" fill="var(--badge-text)">' + (isEn ? "Search" : "搜索") + '</text>' +

              /* Right Side Callout Card: Switchable Engines (Does NOT block cards below!) */
              '<rect x="584" y="72" width="154" height="84" rx="12" fill="rgba(255,255,255,0.92)" stroke="#b8ccb9" stroke-width="1.2" />' +
              '<text x="598" y="92" font-size="11" font-weight="700" fill="#3d7a52">' + (isEn ? "Switch Search Engine:" : "左侧可切换搜索引擎：") + '</text>' +
              '<text x="598" y="111" font-size="11" font-weight="700" fill="#1f2d22">' + (isEn ? "● Google (Default)" : "● Google（默认）") + '</text>' +
              '<text x="598" y="128" font-size="11" fill="#4e6151">' + (isEn ? "○ Bing Search" : "○ Bing 必应搜索") + '</text>' +
              '<text x="598" y="145" font-size="11" fill="#4e6151">' + (isEn ? "Configure more in Settings" : "可在设置中管理") + '</text>' +
              '<path d="M584,105 L570,105" stroke="#3d7a52" stroke-width="1.5" stroke-dasharray="3,3" />' +

              /* Real-Time Match Counter Pill Directly Below Search Box */
              '<rect x="195" y="136" width="276" height="24" rx="12" fill="rgba(61,122,82,0.16)" />' +
              '<text x="333" y="152" text-anchor="middle" font-size="11.5" font-weight="700" fill="#235334">' +
                (isEn ? "• Current match: 2 categories, 3 sites" : "• 当前内容 匹配 2 个分类, 3 个站点") +
              '</text>' +

              /* Always-Visible Section Header: 经常访问 + Instant Filtered Results */
              '<rect x="24" y="172" width="712" height="142" rx="14" fill="rgba(255,255,255,0.55)" />' +
              '<text x="42" y="196" font-size="13" font-weight="700" fill="#1f2d22">' + (isEn ? "Instant Filtered Bookmarks & Frequently Visited (8 sites)" : "实时过滤匹配书签 & 经常访问（共 8 个站点）") + '</text>' +

              /* Card 1 (Matched & Highlighted) */
              '<rect class="anim-card-s1" x="42" y="208" width="214" height="58" rx="12" fill="#ffffff" stroke="#3d7a52" stroke-width="2" />' +
              '<rect x="54" y="219" width="36" height="36" rx="9" fill="#3d7a52" />' +
              '<text x="72" y="242" text-anchor="middle" font-size="13" font-weight="700" fill="var(--badge-text)">NL</text>' +
              '<text x="100" y="234" font-size="13" font-weight="700" fill="#1f2d22">NodeLoc</text>' +
              '<text x="100" y="251" font-size="11" fill="#5e7261">' + (isEn ? "NodeLoc Forum · Matched" : "NodeLoc论坛 · 匹配关键词") + '</text>' +

              /* Card 2 (Matched & Highlighted) */
              '<rect class="anim-card-s1" x="272" y="208" width="214" height="58" rx="12" fill="#ffffff" stroke="#3d7a52" stroke-width="2" />' +
              '<rect x="284" y="219" width="36" height="36" rx="9" fill="#24292f" />' +
              '<text x="302" y="242" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">GH</text>' +
              '<text x="330" y="234" font-size="13" font-weight="700" fill="#1f2d22">' + (isEn ? "CF-Navs Repo" : "CF-Navs 项目地址") + '</text>' +
              '<text x="330" y="251" font-size="11" fill="#5e7261">' + (isEn ? "GitHub Open Source" : "GitHub 开源仓库") + '</text>' +

              /* Card 3 (Matched) */
              '<rect x="502" y="208" width="216" height="58" rx="12" fill="rgba(255,255,255,0.88)" stroke="rgba(255,255,255,0.95)" />' +
              '<rect x="514" y="219" width="36" height="36" rx="9" fill="#f38020" />' +
              '<text x="532" y="242" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">CF</text>' +
              '<text x="560" y="234" font-size="13" font-weight="700" fill="#1f2d22">' + (isEn ? "Cloudflare Console" : "Cloudflare 控制台") + '</text>' +
              '<text x="560" y="251" font-size="11" fill="#5e7261">Workers &amp; D1 Database</text>' +

              /* Bottom Hint Row inside Stage */
              '<text x="42" y="294" font-size="11.5" fill="#3d7a52" font-weight="600">' +
                (isEn ? "✓ Type keyword to filter local bookmarks immediately   |   ✓ Click 'Search' to query external engine" : "✓ 输入文字立即在当前页筛选分类与书签卡片   ｜   ✓ 点击右侧“搜索”按钮可使用所选引擎全网搜索") +
              '</text>' +

              renderCursorGroup("anim-cursor-s1", "anim-ripple1-s1", "anim-ripple2-s1", 305, 105, 175, 105) +
            '</svg>'
          );
        }

        if (stepIndex === 1) {
          // STEP 2: Single Cohesive Top Sticky Category Nav + Subcategory Horizontal Pills
          return (
            '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Primary Category Bar and Secondary Subcategory Pills" : "一级分类导航栏与二级子分类横向切换示意图") + '">' +
              '<rect width="760" height="330" rx="14" fill="#d7e4d3" />' +

              /* 1. Top Sticky Category Bar (Real CF-Navs 示例站点 Layout) */
              '<rect x="24" y="22" width="712" height="56" rx="14" fill="rgba(255,255,255,0.9)" stroke="#ffffff" stroke-width="1.5" />' +

              /* Pill 1: CF-Navs项目地址 5 */
              '<rect x="36" y="34" width="136" height="32" rx="9" fill="#edf3ec" />' +
              '<circle cx="52" cy="50" r="6" fill="#3d7a52" />' +
              '<text x="64" y="54" font-size="11.5" font-weight="600" fill="#4a5d4d">CF-Navs项目 5</text>' +

              /* Pill 2: 论坛导航 2 */
              '<rect x="180" y="34" width="90" height="32" rx="9" fill="#edf3ec" />' +
              '<text x="225" y="54" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a5d4d">论坛导航 2</text>' +

              /* Pill 3 (ACTIVE): Ai服务 27 ▼ with Orange-Red Left Vertical Bar */
              '<rect x="278" y="32" width="108" height="36" rx="10" fill="#ffffff" stroke="#3d7a52" stroke-width="1.8" />' +
              '<rect x="285" y="41" width="4" height="18" rx="2" fill="#e85d3f" />' +
              '<text x="296" y="54" font-size="12" font-weight="700" fill="#1f2d22">Ai服务 27 ▼</text>' +

              /* Pill 4: MAC 45 */
              '<rect x="394" y="34" width="76" height="32" rx="9" fill="#edf3ec" />' +
              '<text x="432" y="54" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a5d4d">MAC 45</text>' +

              /* Pill 5: 编程 54 ▼ */
              '<rect x="478" y="34" width="88" height="32" rx="9" fill="#edf3ec" />' +
              '<text x="522" y="54" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a5d4d">编程 54 ▼</text>' +

              /* Pill 6: 学习 34 */
              '<rect x="574" y="34" width="78" height="32" rx="9" fill="#edf3ec" />' +
              '<text x="613" y="54" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a5d4d">学习 34</text>' +

              /* Step 2 Badge on Right of Top Nav */
              '<circle cx="702" cy="50" r="15" fill="#e85d3f" />' +
              '<text x="702" y="55" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">2</text>' +

              /* 2. Category Section Container with Secondary Sub-Category Horizontal Switch */
              '<rect x="24" y="92" width="712" height="218" rx="16" fill="rgba(255,255,255,0.68)" stroke="rgba(255,255,255,0.85)" />' +

              /* Category Header Bar: Primary Pill + Secondary Subcategory Pills */
              '<rect x="42" y="110" width="112" height="32" rx="9" fill="#3d7a52" />' +
              '<text x="98" y="130" text-anchor="middle" font-size="12" font-weight="700" fill="var(--badge-text)">Ai服务 (27)</text>' +

              /* Active Subcategory Pill */
              '<rect x="164" y="110" width="116" height="32" rx="9" fill="#ffffff" stroke="#3d7a52" stroke-width="1.8" />' +
              '<circle cx="180" cy="126" r="4" fill="#e85d3f" />' +
              '<text x="228" y="130" text-anchor="middle" font-size="12" font-weight="700" fill="#1f2d22">ai子分类 5</text>' +

              /* Callout Note on Right of Subcategory Row */
              '<rect x="466" y="110" width="250" height="32" rx="8" fill="rgba(61,122,82,0.12)" />' +
              '<text x="591" y="130" text-anchor="middle" font-size="11" font-weight="600" fill="#235334">' +
                (isEn ? "↔ Click sub-tags to switch bookmarks" : "↔ 点击组内二级分类标签，横向切换书签") +
              '</text>' +

              /* Bookmark Cards Grid inside Category Section (3x2 clean grid) */
              '<rect x="42" y="156" width="214" height="62" rx="12" fill="#ffffff" stroke="#b9d1be" />' +
              '<rect x="54" y="169" width="36" height="36" rx="9" fill="#10a37f" />' +
              '<text x="72" y="192" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">AI</text>' +
              '<text x="102" y="183" font-size="13" font-weight="700" fill="#1f2d22">ChatGPT</text>' +
              '<text x="102" y="201" font-size="11" fill="#647868">' + (isEn ? "OpenAI Official Chat" : "OpenAI 官方对话服务") + '</text>' +

              '<rect x="273" y="156" width="214" height="62" rx="12" fill="#ffffff" stroke="#b9d1be" />' +
              '<rect x="285" y="169" width="36" height="36" rx="9" fill="#d97757" />' +
              '<text x="303" y="192" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">CL</text>' +
              '<text x="333" y="183" font-size="13" font-weight="700" fill="#1f2d22">Claude 3.7</text>' +
              '<text x="333" y="201" font-size="11" fill="#647868">' + (isEn ? "Anthropic Coding Assistant" : "Anthropic 编程与写作助手") + '</text>' +

              '<rect x="504" y="156" width="214" height="62" rx="12" fill="#ffffff" stroke="#b9d1be" />' +
              '<rect x="516" y="169" width="36" height="36" rx="9" fill="#2563eb" />' +
              '<text x="534" y="192" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">GM</text>' +
              '<text x="564" y="183" font-size="13" font-weight="700" fill="#1f2d22">Gemini Pro</text>' +
              '<text x="564" y="201" font-size="11" fill="#647868">' + (isEn ? "Google Multimodal AI" : "Google 多模态大模型") + '</text>' +

              '<rect x="42" y="230" width="214" height="62" rx="12" fill="rgba(255,255,255,0.9)" />' +
              '<rect x="54" y="243" width="36" height="36" rx="9" fill="#6366f1" />' +
              '<text x="72" y="266" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">MJ</text>' +
              '<text x="102" y="257" font-size="13" font-weight="700" fill="#1f2d22">Midjourney</text>' +
              '<text x="102" y="275" font-size="11" fill="#647868">' + (isEn ? "AI Art Generation" : "AI 视觉与插画生成") + '</text>' +

              '<rect x="273" y="230" width="214" height="62" rx="12" fill="rgba(255,255,255,0.9)" />' +
              '<rect x="285" y="243" width="36" height="36" rx="9" fill="#0ea5e9" />' +
              '<text x="303" y="266" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">PX</text>' +
              '<text x="333" y="257" font-size="13" font-weight="700" fill="#1f2d22">Perplexity</text>' +
              '<text x="333" y="275" font-size="11" fill="#647868">' + (isEn ? "AI Answer Engine" : "AI 实时搜索引擎") + '</text>' +

              '<rect x="504" y="230" width="214" height="62" rx="12" fill="rgba(255,255,255,0.65)" stroke="#b9d1be" stroke-dasharray="4,4" />' +
              '<text x="611" y="258" text-anchor="middle" font-size="11.5" font-weight="700" fill="#3d7a52">' + (isEn ? "Supports Top Bar or Left Sidebar" : "支持“顶部固定”与“左侧悬浮”") + '</text>' +
              '<text x="611" y="276" text-anchor="middle" font-size="11" fill="#5a6d5d">' + (isEn ? "Switchable in Settings → Layout" : "可在【设置 → 布局与导航】中切换") + '</text>' +

              renderCursorGroup("anim-cursor-s2", "anim-ripple1-s2", "anim-ripple2-s2", 312, 54, 236, 134) +
            '</svg>'
          );
        }

        if (stepIndex === 2) {
          // STEP 3: Bookmark Card + Real Right-Click Menu ("编辑") -> Crisp Edit Modal on Right
          var nodeLocBookmarkCard = currentCardStyle === "icon"
            ? '<rect x="114" y="56" width="70" height="70" rx="12" fill="var(--card-surface)" stroke="var(--accent)" stroke-width="2" />' +
              '<rect x="127" y="69" width="44" height="44" rx="11" fill="var(--accent)" />' +
              '<text x="149" y="97" text-anchor="middle" font-size="15" font-weight="700" fill="var(--badge-text)">NL</text>'
            : '<rect x="28" y="56" width="244" height="70" rx="14" fill="var(--card-surface)" stroke="var(--accent)" stroke-width="2" />' +
              '<rect x="42" y="69" width="44" height="44" rx="11" fill="var(--accent)" />' +
              '<text x="64" y="97" text-anchor="middle" font-size="15" font-weight="700" fill="var(--badge-text)">NL</text>' +
              '<text x="98" y="87" font-size="13.5" font-weight="700" fill="#1f2d22">NodeLoc</text>' +
              '<text x="98" y="106" font-size="11.5" fill="#647868">' + (isEn ? "NodeLoc Forum" : "NodeLoc论坛") + '</text>';
          return (
            '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Bookmark Card Right-Click Edit and Edit Modal" : "书签卡片右键编辑菜单与编辑书签弹窗示意图") + '">' +
              '<rect width="760" height="330" rx="14" fill="#d7e4d3" />' +

              /* Left Column Header with Badge 3 */
              '<circle cx="42" cy="34" r="14" fill="#e85d3f" />' +
              '<text x="42" y="39" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">3</text>' +
              '<text x="64" y="39" font-size="13" font-weight="700" fill="#1f2d22">' + (isEn ? "① Right-click card → Click 'Edit'" : "① 左键打开网站 · 右键点击“编辑”") + '</text>' +

              /* Card target reflects the configured information or icon-only style. */
              nodeLocBookmarkCard +

              /* Real Right-Click Context Menu Below Card 1 (Single real item: "编辑", placed in dedicated gap y=136..180) */
              '<rect x="148" y="136" width="124" height="44" rx="10" fill="#ffffff" stroke="#3d7a52" stroke-width="1.5" filter="drop-shadow(0 8px 16px rgba(0,0,0,0.12))" />' +
              '<rect x="154" y="142" width="112" height="32" rx="7" fill="#e6f2ea" />' +
              '<text x="210" y="162" text-anchor="middle" font-size="12.5" font-weight="700" fill="#235334">' + (isEn ? "Edit (编辑)" : "编辑") + '</text>' +

              /* Arrow from "编辑" context menu pointing to Right Edit Modal */
              '<path d="M276,158 L308,158" stroke="#e85d3f" stroke-width="2.2" stroke-linecap="round" />' +
              '<polygon points="313,158 305,154 305,162" fill="#e85d3f" />' +

              /* Card 2 (Placed cleanly at y=200..268) */
              '<rect x="28" y="200" width="244" height="68" rx="14" fill="rgba(255,255,255,0.82)" />' +
              '<rect x="42" y="212" width="44" height="44" rx="11" fill="#10a37f" />' +
              '<text x="64" y="240" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">AI</text>' +
              '<text x="98" y="230" font-size="13.5" font-weight="700" fill="#1f2d22">ChatGPT</text>' +
              '<text x="98" y="249" font-size="11.5" fill="#647868">' + (isEn ? "OpenAI Official Service" : "OpenAI官方对话服务") + '</text>' +

              '<text x="28" y="294" font-size="11" fill="#4a5d4d" font-weight="600">' +
                (isEn ? "• Unauthenticated click prompts Admin Login" : "• 未登录时点击“编辑”会自动拉起管理员登录") +
              '</text>' +

              /* Right Side: Real Edit Bookmark Dialog (100% Crisp Opacity) */
              '<rect x="318" y="22" width="418" height="286" rx="16" fill="#ffffff" stroke="#9ab59e" stroke-width="1.5" />' +
              '<text x="338" y="48" font-size="13.5" font-weight="700" fill="#1f2d22">' + (isEn ? "② Edit Bookmark Modal (Category / Private / Icon)" : "② 编辑书签弹窗（修改分类 / 私密 / 图标 / 删除）") + '</text>' +
              '<line x1="318" y1="60" x2="736" y2="60" stroke="#e5ede6" stroke-width="1" />' +

              /* Row 1: Category (Move) & Bookmark Title */
              '<rect x="338" y="72" width="184" height="34" rx="8" fill="#f4f8f5" stroke="#d0ded2" />' +
              '<text x="348" y="93" font-size="11" font-weight="600" fill="#334636">' + (isEn ? "Category: CF-Navs ▾" : "所属分类：CF-Navs项目 ▾") + '</text>' +
              '<rect x="532" y="72" width="184" height="34" rx="8" fill="#f4f8f5" stroke="#d0ded2" />' +
              '<text x="542" y="93" font-size="11" font-weight="600" fill="#1f2d22">' + (isEn ? "Title: CF-Navs Repo" : "标题：CF-Navs 项目地址") + '</text>' +

              /* Row 2: URL & Private Link Checkbox */
              '<rect x="338" y="116" width="234" height="34" rx="8" fill="#f4f8f5" stroke="#d0ded2" />' +
              '<text x="348" y="137" font-size="11" fill="#4a5d4d">URL: CF-Navs 项目主页</text>' +
              '<rect x="582" y="116" width="134" height="34" rx="8" fill="#e8f3ea" stroke="#3d7a52" stroke-width="1.2" />' +
              '<rect x="592" y="126" width="14" height="14" rx="3" fill="#3d7a52" />' +
              '<text x="599" y="137" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">✓</text>' +
              '<text x="612" y="137" font-size="11" font-weight="700" fill="#235334">' + (isEn ? "Private Link" : "设为私密链接") + '</text>' +

              /* Row 3: Icon Source (Favicon.im / 文字图标 / Google / Iconify) */
              '<text x="338" y="170" font-size="11.5" font-weight="700" fill="#334636">' + (isEn ? "Icon Source (4 Options):" : "图标来源（支持 4 种方式切换）：") + '</text>' +
              '<rect x="338" y="178" width="88" height="28" rx="7" fill="#3d7a52" />' +
              '<text x="382" y="196" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">Favicon.im</text>' +
              '<rect x="434" y="178" width="86" height="28" rx="7" fill="#eef3ef" stroke="#d0ded2" />' +
              '<text x="477" y="196" text-anchor="middle" font-size="11" font-weight="600" fill="#4a5d4d">' + (isEn ? "Text Icon" : "文字图标") + '</text>' +
              '<rect x="528" y="178" width="86" height="28" rx="7" fill="#eef3ef" stroke="#d0ded2" />' +
              '<text x="571" y="196" text-anchor="middle" font-size="11" font-weight="600" fill="#4a5d4d">Google</text>' +
              '<rect x="622" y="178" width="94" height="28" rx="7" fill="#eef3ef" stroke="#d0ded2" />' +
              '<text x="669" y="196" text-anchor="middle" font-size="11" font-weight="600" fill="#4a5d4d">Iconify</text>' +

              /* Row 4: Description Display Policy */
              '<rect x="338" y="216" width="378" height="30" rx="8" fill="#f7faf7" stroke="#dce6dd" />' +
              '<text x="350" y="235" font-size="11" font-weight="600" fill="#4a5d4d">' +
                (isEn ? "Description:   ● Always Show     ○ On Hover     ○ Hide" : "描述显示策略： ● 始终显示     ○ 悬停显示     ○ 隐藏") +
              '</text>' +

              /* Row 5: Bottom Buttons (Delete on Left, Cancel & Save on Right) */
              '<rect x="338" y="258" width="68" height="32" rx="8" fill="#fee2e2" stroke="#fca5a5" />' +
              '<text x="372" y="278" text-anchor="middle" font-size="11.5" font-weight="700" fill="#dc2626">' + (isEn ? "Delete" : "删除") + '</text>' +
              '<rect x="562" y="258" width="70" height="32" rx="8" fill="#eef3ef" />' +
              '<text x="597" y="278" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a5d4d">' + (isEn ? "Cancel" : "取消") + '</text>' +
              '<rect x="640" y="258" width="76" height="32" rx="8" fill="#3d7a52" />' +
              '<text x="678" y="278" text-anchor="middle" font-size="11.5" font-weight="700" fill="#ffffff">' + (isEn ? "Save" : "保存") + '</text>' +

              renderCursorGroup("anim-cursor-s3", "anim-ripple1-s3", "anim-ripple2-s3", 155, 110, 215, 162) +
            '</svg>'
          );
        }

        if (stepIndex === 3) {
          // STEP 4: Global Spotlight Search — Fixed Left Shortcut Card (Zero Overlap!)
          return (
            '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Spotlight Quick Search Modal" : "Spotlight 快捷搜索弹窗示意图") + '">' +
              /* Dark Frosted Overlay Backdrop */
              '<rect width="760" height="330" rx="14" fill="#1e2a22" />' +

              /* Left Panel: Dedicated Shortcut Instruction Card (x=22..202, y=24..306) */
              '<rect x="22" y="24" width="180" height="282" rx="14" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.14)" />' +

              /* Row 1: Badge 4 + Title (y=44..68) */
              '<circle cx="48" cy="54" r="14" fill="#e85d3f" />' +
              '<text x="48" y="59" text-anchor="middle" font-size="12.5" font-weight="700" fill="#ffffff">4</text>' +
              '<text x="70" y="59" font-size="13" font-weight="700" fill="#ecfdf5">' + (isEn ? "Quick Summon" : "快捷键唤起") + '</text>' +

              /* Row 2: Animated [Ctrl] + [K] Keycaps using direct Y coordinates y=84..122 */
              '<g class="anim-key-s4">' +
                '<rect x="36" y="84" width="60" height="38" rx="9" fill="#334155" stroke="#94a3b8" stroke-width="1.5" />' +
                '<text x="66" y="108" text-anchor="middle" font-size="13.5" font-weight="700" fill="#f8fafc">Ctrl</text>' +
                '<text x="108" y="108" text-anchor="middle" font-size="14" font-weight="700" fill="#94a3b8">+</text>' +
                '<rect x="120" y="84" width="44" height="38" rx="9" fill="#3d7a52" stroke="#86efac" stroke-width="1.5" />' +
                '<text x="142" y="108" text-anchor="middle" font-size="14" font-weight="700" fill="var(--badge-text)">K</text>' +
              '</g>' +

              /* Row 3: Mac & Slash Shortcut Badges (y=140..208) */
              '<rect x="36" y="140" width="152" height="30" rx="8" fill="rgba(255,255,255,0.08)" />' +
              '<text x="112" y="159" text-anchor="middle" font-size="11.5" font-weight="600" fill="#d1fae5">' + (isEn ? "Mac Shortcut: ⌘ + K" : "Mac 快捷键：⌘ + K") + '</text>' +

              '<rect x="36" y="178" width="152" height="30" rx="8" fill="rgba(255,255,255,0.08)" />' +
              '<text x="112" y="197" text-anchor="middle" font-size="11.5" font-weight="600" fill="#d1fae5">' + (isEn ? "Or press  /  key" : "或直接按  /  键唤起") + '</text>' +

              /* Row 4: Keyboard Navigation Summary (y=222..288) */
              '<line x1="36" y1="222" x2="188" y2="222" stroke="rgba(255,255,255,0.12)" />' +
              '<text x="36" y="244" font-size="11" fill="#a7f3d0" font-weight="600">' + (isEn ? "• ↑ ↓ : Navigate results" : "• ↑ ↓ 键：上下切换结果") + '</text>' +
              '<text x="36" y="264" font-size="11" fill="#a7f3d0" font-weight="600">' + (isEn ? "• Enter : Open bookmark" : "• Enter 键：立即打开站点") + '</text>' +
              '<text x="36" y="284" font-size="11" fill="#a7f3d0" font-weight="600">' + (isEn ? "• Esc : Close Spotlight" : "• Esc 键：关闭搜索面板") + '</text>' +

              /* Right Panel: Centered White Spotlight Modal (x=218..738, y=24..306) */
              '<rect x="218" y="24" width="520" height="282" rx="16" fill="#ffffff" filter="drop-shadow(0 18px 36px rgba(0,0,0,0.4))" />' +

              /* Top Search Input Bar inside Spotlight (x=236..720, y=40..84) */
              '<rect x="236" y="40" width="484" height="44" rx="11" fill="#f4f8f5" stroke="#3d7a52" stroke-width="1.8" />' +
              '<circle cx="256" cy="62" r="7" fill="none" stroke="#3d7a52" stroke-width="2" />' +
              '<line x1="261" y1="67" x2="266" y2="72" stroke="#3d7a52" stroke-width="2" stroke-linecap="round" />' +
              '<text x="278" y="67" font-size="13.5" font-weight="600" fill="#1f2d22">' + (isEn ? "Search bookmarks..." : "搜索书签...") + '</text>' +
              '<rect x="628" y="48" width="82" height="28" rx="14" fill="#e6f2ea" stroke="#b9d1be" />' +
              '<text x="669" y="66" text-anchor="middle" font-size="11" font-weight="700" fill="#235334">' + (isEn ? "Frequent" : "常用书签") + '</text>' +

              /* Animated Selection Highlight Bar (Moves across Row 1 y=96, Row 2 y=140, Row 3 y=184) */
              '<rect class="anim-row-s4" x="236" y="96" width="484" height="38" rx="10" fill="#e8f2ff" stroke="#93c5fd" stroke-width="1.2" />' +

              /* Result Row 1 (y=96..134) */
              '<rect x="248" y="102" width="26" height="26" rx="7" fill="#24292f" />' +
              '<text x="261" y="119" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">GH</text>' +
              '<text x="284" y="119" font-size="13" font-weight="700" fill="#1e293b">' + (isEn ? "CF-Navs Repository — GitHub" : "CF-Navs 项目地址 — GitHub 仓库") + '</text>' +
              '<text x="706" y="119" text-anchor="end" font-size="11" font-weight="600" fill="#64748b">CF-Navs项目地址</text>' +

              /* Result Row 2 (y=140..178) */
              '<rect x="248" y="146" width="26" height="26" rx="7" fill="#10a37f" />' +
              '<text x="261" y="163" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">AI</text>' +
              '<text x="284" y="163" font-size="13" font-weight="700" fill="#1e293b">' + (isEn ? "ChatGPT — OpenAI Official" : "ChatGPT — OpenAI 官方对话") + '</text>' +
              '<text x="706" y="163" text-anchor="end" font-size="11" font-weight="600" fill="#64748b">Ai服务 / ai子分类</text>' +

              /* Result Row 3 (y=184..222) */
              '<rect x="248" y="190" width="26" height="26" rx="7" fill="#f38020" />' +
              '<text x="261" y="207" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">CF</text>' +
              '<text x="284" y="207" font-size="13" font-weight="700" fill="#1e293b">' + (isEn ? "Cloudflare Workers & D1 Console" : "Cloudflare Workers & D1 控制台") + '</text>' +
              '<text x="706" y="207" text-anchor="end" font-size="11" font-weight="600" fill="#64748b">编程 / 云服务</text>' +

              /* Result Row 4 (y=228..266) */
              '<rect x="248" y="234" width="26" height="26" rx="7" fill="#3d7a52" />' +
              '<text x="261" y="251" text-anchor="middle" font-size="11" font-weight="700" fill="var(--badge-text)">NL</text>' +
              '<text x="284" y="251" font-size="13" font-weight="700" fill="#1e293b">' + (isEn ? "NodeLoc Forum" : "NodeLoc论坛") + '</text>' +
              '<text x="706" y="251" text-anchor="end" font-size="11" font-weight="600" fill="#64748b">论坛导航</text>' +

              /* Bottom Status Bar (Exact match to CF-Navs 示例站点) */
              '<line x1="218" y1="270" x2="738" y2="270" stroke="#e2e8f0" stroke-width="1" />' +
              '<text x="478" y="292" text-anchor="middle" font-size="12" font-weight="700" fill="#475569">' +
                (isEn ? "↑ ↓ Select   •   Enter Open   •   Esc Close" : "↑ ↓ 选择   •   Enter 打开   •   Esc 关闭") +
              '</text>' +
            '</svg>'
          );
        }

        if (stepIndex === 4) {
          // STEP 5: SettingsPanel — 7 Real Tabs + 22 Themes + Card/Nav Toggles
          var detailStyleFill = detailCardActive ? "var(--accent)" : "var(--pill-bg)";
          var detailStyleText = detailCardActive ? "var(--badge-text)" : "var(--text-secondary)";
          var iconStyleFill = iconCardActive ? "var(--accent)" : "var(--pill-bg)";
          var iconStyleText = iconCardActive ? "var(--badge-text)" : "var(--text-secondary)";
          return (
            '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Settings Panel and 22 Themes" : "设置面板 7 大选项卡与 22 套内置主题示意图") + '">' +
              '<defs>' +
                '<linearGradient id="thOcean" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f2137"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>' +
                '<linearGradient id="thAmethyst" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#24183e"/><stop offset="100%" stop-color="#9333ea"/></linearGradient>' +
                '<linearGradient id="thEmber" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#221d1a"/><stop offset="100%" stop-color="#ea580c"/></linearGradient>' +
                '<linearGradient id="thAurora" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0d2624"/><stop offset="100%" stop-color="#14b8a6"/></linearGradient>' +
              '</defs>' +
              '<rect width="760" height="330" rx="14" fill="#d7e4d3" />' +

              /* Main Settings Panel Window */
              '<rect x="22" y="16" width="716" height="298" rx="16" fill="#ffffff" stroke="#b8ccb9" stroke-width="1.5" />' +

              /* Left 7 Tabs Sidebar (Exact 7 tabs from logged-in CF-Navs 示例站点) */
              '<rect x="22" y="16" width="168" height="298" rx="16" fill="#f3f7f4" />' +
              '<text x="40" y="44" font-size="13" font-weight="700" fill="#1f2d22">⚙ ' + (isEn ? "Settings (7 Tabs)" : "站点设置中心") + '</text>' +

              '<text x="40" y="72" font-size="11.5" fill="#4a5d4d">' + (isEn ? "1. Site Info" : "1. 站点设置") + '</text>' +
              '<rect x="32" y="84" width="148" height="28" rx="8" fill="#3d7a52" />' +
              '<text x="44" y="102" font-size="11.5" font-weight="700" fill="var(--badge-text)">' + (isEn ? "2. Theme & Cards ✓" : "2. 外观与卡片 ✓") + '</text>' +
              '<text x="40" y="130" font-size="11.5" fill="#4a5d4d">' + (isEn ? "3. Visual & Backdrop" : "3. 高级与视觉") + '</text>' +
              '<text x="40" y="154" font-size="11.5" fill="#4a5d4d">' + (isEn ? "4. Layout & Nav" : "4. 布局与导航") + '</text>' +
              '<text x="40" y="178" font-size="11.5" fill="#4a5d4d">' + (isEn ? "5. Search Engines" : "5. 搜索设置") + '</text>' +
              '<text x="40" y="202" font-size="11.5" fill="#4a5d4d">' + (isEn ? "6. Custom CSS/JS" : "6. 自定义样式/脚本") + '</text>' +
              '<text x="40" y="226" font-size="11.5" fill="#4a5d4d">' + (isEn ? "7. Account Security" : "7. 账号安全") + '</text>' +

              /* Step 5 Badge + Live Preview Pill */
              '<circle cx="50" cy="272" r="14" fill="#e85d3f" />' +
              '<text x="50" y="277" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">5</text>' +
              '<text x="72" y="276" font-size="11" font-weight="700" fill="#235334">' + (isEn ? "Live Preview" : "支持实时预览") + '</text>' +

              /* Right Panel: Glassmorphism Themes (13) */
              '<text x="212" y="44" font-size="12" font-weight="700" fill="#1f2d22">' + (isEn ? "Glassmorphism Themes (13 Presets)" : "【毛玻璃】配色方案（共 13 套预设）") + '</text>' +

              '<rect x="212" y="56" width="118" height="60" rx="10" fill="url(#thOcean)" stroke="#3b82f6" stroke-width="2" />' +
              '<text x="224" y="79" font-size="12" font-weight="700" fill="#fff">深海蔚蓝</text>' +
              '<text x="224" y="98" font-size="10" fill="#bfdbfe">Deep Ocean</text>' +

              '<rect x="342" y="56" width="118" height="60" rx="10" fill="url(#thAmethyst)" />' +
              '<text x="354" y="79" font-size="12" font-weight="700" fill="#fff">紫晶破晓</text>' +
              '<text x="354" y="98" font-size="10" fill="#e9d5ff">Amethyst</text>' +

              '<rect x="472" y="56" width="118" height="60" rx="10" fill="url(#thEmber)" />' +
              '<text x="484" y="79" font-size="12" font-weight="700" fill="#fff">余烬夜航</text>' +
              '<text x="484" y="98" font-size="10" fill="#fed7aa">Ember Night</text>' +

              '<rect x="602" y="56" width="118" height="60" rx="10" fill="url(#thAurora)" />' +
              '<text x="614" y="79" font-size="12" font-weight="700" fill="#fff">极光苔原</text>' +
              '<text x="614" y="98" font-size="10" fill="#99f6e4">Aurora</text>' +

              /* Eye-Care Solid Themes (9 Presets) */
              '<text x="212" y="142" font-size="12" font-weight="700" fill="#1f2d22">' + (isEn ? "Eye-Care Solid Theme Presets (9)" : "【护眼纯色】配色预设（共 9 套）") + '</text>' +

              '<rect x="212" y="154" width="118" height="44" rx="10" fill="#d8e5d4" stroke="#3d7a52" stroke-width="2.2" />' +
              '<text x="271" y="180" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1f2d22">' + (isEn ? "✓ Sage Green" : "✓ 纸页鼠尾草") + '</text>' +

              '<rect x="342" y="154" width="118" height="44" rx="10" fill="#eadbcf" stroke="#c29b7f" />' +
              '<text x="401" y="180" text-anchor="middle" font-size="11.5" font-weight="600" fill="#433024">' + (isEn ? "Warm Terracotta" : "温暖陶土") + '</text>' +

              '<rect x="472" y="154" width="118" height="44" rx="10" fill="#ebe4cc" stroke="#b8a878" />' +
              '<text x="531" y="180" text-anchor="middle" font-size="11.5" font-weight="600" fill="#3f3822">' + (isEn ? "Autumn Wheat" : "澄澈秋麦") + '</text>' +

              '<rect x="602" y="154" width="118" height="44" rx="10" fill="#d5e2e8" stroke="#7fa1b2" />' +
              '<text x="661" y="180" text-anchor="middle" font-size="11.5" font-weight="600" fill="#1e333d">' + (isEn ? "Sea Slate" : "静谧海岩") + '</text>' +

              /* Card Style & Navigation Layout Options */
              '<rect x="212" y="216" width="248" height="76" rx="11" fill="#f7faf7" stroke="#dce6dd" />' +
              '<text x="226" y="238" font-size="11.5" font-weight="700" fill="#1f2d22">' + (isEn ? "Bookmark Card Style" : "书签卡片风格") + '</text>' +
              '<rect x="226" y="250" width="106" height="30" rx="8" fill="' + detailStyleFill + '" />' +
              '<text x="279" y="269" text-anchor="middle" font-size="11" font-weight="700" fill="' + detailStyleText + '">' + (detailCardActive ? "✓ " : "") + (isEn ? "Detailed" : "详情风格") + '</text>' +
              '<rect x="340" y="250" width="106" height="30" rx="8" fill="' + iconStyleFill + '" />' +
              '<text x="393" y="269" text-anchor="middle" font-size="11" font-weight="' + (iconCardActive ? "700" : "400") + '" fill="' + iconStyleText + '">' + (iconCardActive ? "✓ " : "") + (isEn ? "Minimal Icons" : "极简纯图标") + '</text>' +

              '<rect x="472" y="216" width="248" height="76" rx="11" fill="#f7faf7" stroke="#dce6dd" />' +
              '<text x="486" y="238" font-size="11.5" font-weight="700" fill="#1f2d22">' + (isEn ? "Category Nav Position" : "分类导航显示位置") + '</text>' +
              '<rect x="486" y="250" width="106" height="30" rx="8" fill="#3d7a52" />' +
              '<text x="539" y="269" text-anchor="middle" font-size="11" font-weight="700" fill="var(--badge-text)">' + (isEn ? "✓ Top Sticky" : "✓ 顶部固定") + '</text>' +
              '<rect x="600" y="250" width="106" height="30" rx="8" fill="#e9f0ea" />' +
              '<text x="653" y="269" text-anchor="middle" font-size="11" fill="#4a5d4d">' + (isEn ? "Left Sidebar" : "左侧悬浮") + '</text>' +

              renderCursorGroup("anim-cursor-s5", "anim-ripple1-s5", "anim-ripple2-s5", 275, 90, 275, 180) +
            '</svg>'
          );
        }

        // STEP 6: Top-Right Circular Floating Action Buttons (⋮ -> ?, A, ⚙) + Bottom-Right ^ + Admin Features
        return (
          '<svg class="guide-stage-svg" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (isEn ? "Top-Right Floating Circular Buttons and Admin Overview" : "右上角圆形浮动菜单与后台管理功能概览示意图") + '">' +
            '<rect width="760" height="330" rx="14" fill="#d7e4d3" />' +

            /* Top Navigation Bar with Right ⋮ Trigger Button (cx=702, cy=46) */
            '<rect x="24" y="20" width="712" height="52" rx="14" fill="rgba(255,255,255,0.9)" stroke="#ffffff" />' +
            '<rect x="38" y="34" width="96" height="26" rx="7" fill="#ffffff" stroke="#3d7a52" />' +
            '<rect x="43" y="40" width="3" height="14" rx="1.5" fill="#e85d3f" />' +
            '<text x="53" y="51" font-size="11" font-weight="700" fill="#1f2d22">' + (isEn ? "All Bookmarks" : "全部导航") + '</text>' +
            '<text x="150" y="51" font-size="11" font-weight="600" fill="#4a5d4d">CF-Navs项目 5</text>' +
            '<text x="252" y="51" font-size="11" font-weight="600" fill="#4a5d4d">Ai服务 27 ▼</text>' +

            /* Top-Right ⋮ Button */
            '<circle cx="702" cy="46" r="17" fill="#e6f2ea" stroke="#3d7a52" stroke-width="1.5" />' +
            '<circle cx="702" cy="40" r="1.8" fill="#1f2d22" />' +
            '<circle cx="702" cy="46" r="1.8" fill="#1f2d22" />' +
            '<circle cx="702" cy="52" r="1.8" fill="#1f2d22" />' +

            /* Real Vertical Circular Floating Buttons Expanded Under ⋮ (cx=702, cy=104 / 154 / 204) */
            /* 1. ? Guide Button */
            '<circle cx="702" cy="104" r="20" fill="#3d7a52" stroke="#ffffff" stroke-width="2.5" filter="drop-shadow(0 6px 12px rgba(61,122,82,0.35))" />' +
            '<text x="702" y="110" text-anchor="middle" font-size="16" font-weight="800" fill="var(--badge-text)">?</text>' +
            /* Callout Pill Left of ? Button */
            '<rect x="534" y="88" width="140" height="32" rx="9" fill="#ffffff" stroke="#3d7a52" stroke-width="1.5" />' +
            '<text x="604" y="108" text-anchor="middle" font-size="11.5" font-weight="700" fill="#235334">' + (isEn ? "Reopen Guide (?)" : "使用指南（随时回看）") + '</text>' +
            '<line x1="674" y1="104" x2="682" y2="104" stroke="#3d7a52" stroke-width="1.8" />' +
            /* Step 6 Badge next to ? Callout */
            '<circle cx="508" cy="104" r="14" fill="#e85d3f" />' +
            '<text x="508" y="109" text-anchor="middle" font-size="12.5" font-weight="700" fill="#ffffff">6</text>' +

            /* 2. A Theme Toggle */
            '<circle cx="702" cy="154" r="19" fill="#ffffff" stroke="#9ab59e" stroke-width="1.5" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.08))" />' +
            '<text x="702" y="160" text-anchor="middle" font-size="14" font-weight="800" fill="#1f2d22">A</text>' +
            '<rect x="546" y="139" width="128" height="30" rx="8" fill="rgba(255,255,255,0.88)" />' +
            '<text x="610" y="158" text-anchor="middle" font-size="11" font-weight="600" fill="#4a5d4d">' + (isEn ? "Theme Toggle (A)" : "切换主题 (A)") + '</text>' +

            /* 3. ⚙ Admin Entry */
            '<circle cx="702" cy="204" r="19" fill="#ffffff" stroke="#9ab59e" stroke-width="1.5" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.08))" />' +
            '<text x="702" y="210" text-anchor="middle" font-size="15" font-weight="700" fill="#1f2d22">⚙</text>' +
            '<rect x="546" y="189" width="128" height="30" rx="8" fill="rgba(255,255,255,0.88)" />' +
            '<text x="610" y="208" text-anchor="middle" font-size="11" font-weight="600" fill="#4a5d4d">' + (isEn ? "Admin Entry (⚙)" : "管理员入口 (⚙)") + '</text>' +

            /* 4. Bottom-Right Back-to-Top Rounded Square Button (^) */
            '<rect x="684" y="264" width="36" height="36" rx="10" fill="rgba(255,255,255,0.9)" stroke="#9ab59e" stroke-width="1.2" />' +
            '<path d="M695,285 L702,277 L709,285" fill="none" stroke="#1f2d22" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />' +
            '<text x="672" y="286" text-anchor="end" font-size="11" font-weight="600" fill="#4a5d4d">' + (isEn ? "Back to Top" : "返回顶部") + '</text>' +

            /* Left Welcome & Admin Capabilities Summary (x=24..476) */
            '<rect x="24" y="88" width="454" height="102" rx="16" fill="rgba(255,255,255,0.92)" />' +
            '<circle cx="64" cy="139" r="22" fill="#3d7a52" />' +
            '<path d="M55,139 L62,146 L74,132" fill="none" stroke="var(--badge-text)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />' +
            '<text x="100" y="122" font-size="15.5" font-weight="700" fill="#1f2d22">' + (isEn ? "Ready to use CF-Navs!" : "准备就绪，立即开启高效导航！") + '</text>' +
            '<text x="100" y="145" font-size="12" fill="#4a5d4d">' + (isEn ? "Closing this guide records localStorage['cf-navs:guide-seen']=1." : "关闭后将自动写入已读标记，后续访问不再自动弹窗打扰。") + '</text>' +
            '<text x="100" y="167" font-size="12" font-weight="700" fill="#3d7a52">' + (isEn ? "Click the top-right menu and choose ? to reopen this guide." : "点击右上角更多菜单中的？按钮，可随时重温本指南。") + '</text>' +

            /* Two Bottom Feature Cards: Visit Analytics & Multi-Format Data Import */
            '<rect x="24" y="204" width="220" height="102" rx="14" fill="rgba(255,255,255,0.86)" />' +
            '<text x="40" y="230" font-size="12.5" font-weight="700" fill="#1f2d22">' + (isEn ? "Visit Analytics (Admin)" : "访问统计分析（后台）") + '</text>' +
            '<text x="40" y="252" font-size="11" fill="#4a5d4d">' + (isEn ? "• Total clicks & visited/unvisited stats" : "• 累计总点击、已访问/零访问统计") + '</text>' +
            '<text x="40" y="271" font-size="11" fill="#4a5d4d">' + (isEn ? "• Top 20 most visited bookmarks" : "• 最常访问 Top 20 书签排行榜") + '</text>' +
            '<text x="40" y="290" font-size="11" fill="#4a5d4d">' + (isEn ? "• Auto 'Frequently Visited' on home" : "• 首页自动聚合“经常访问”站点") + '</text>' +

            '<rect x="258" y="204" width="220" height="102" rx="14" fill="rgba(255,255,255,0.86)" />' +
            '<text x="274" y="230" font-size="12.5" font-weight="700" fill="#1f2d22">' + (isEn ? "Data Backup & Import" : "数据备份与一键迁移") + '</text>' +
            '<text x="274" y="252" font-size="11" fill="#4a5d4d">' + (isEn ? "• Full CF-Navs JSON backup & restore" : "• CF-Navs JSON 完整备份与恢复") + '</text>' +
            '<text x="274" y="271" font-size="11" fill="#4a5d4d">' + (isEn ? "• One-click Sun-Panel data import" : "• 支持 Sun-Panel 数据一键转换") + '</text>' +
            '<text x="274" y="290" font-size="11" fill="#4a5d4d">' + (isEn ? "• Browser HTML bookmark import" : "• 支持浏览器书签 HTML 导入") + '</text>' +

            renderCursorGroup("anim-cursor-s6", "anim-ripple1-s6", "anim-ripple2-s6", 702, 46, 702, 104) +
          '</svg>'
        );
      }

      // Render Current Guide Step
      function renderGuideStep() {
        var stepObj = stepsData[currentStep];
        var copy = stepObj[currentLang];
        var isEn = currentLang === "en";

        document.getElementById("guideModalTitle").textContent = isEn ? "CF-Navs User Guide" : "CF-Navs 使用指南";
        document.getElementById("guideStepCounter").textContent =
          (isEn ? "Step " : "第 ") + (currentStep + 1) + " / " + stepsData.length + (isEn ? "" : " 步");
        document.getElementById("stepNumberBadge").textContent = String(stepObj.num);
        document.getElementById("stepHeading").textContent = copy.title;
        document.getElementById("stepDescription").textContent = copy.desc;
        document.getElementById("stepQuickTip").textContent = copy.tip;
        document.getElementById("replayBtnLabel").textContent = isEn ? "Replay" : "重播动效";
        document.getElementById("keyboardHintText").innerHTML = isEn
          ? 'Keys <kbd class="guide-kbd-key">◀</kbd> <kbd class="guide-kbd-key">▶</kbd> to switch · <kbd class="guide-kbd-key">Esc</kbd> to close'
          : '键盘 <kbd class="guide-kbd-key">◀</kbd> <kbd class="guide-kbd-key">▶</kbd> 切换步骤 · <kbd class="guide-kbd-key">Esc</kbd> 关闭';

        // Stage SVG
        var stageWrap = document.getElementById("guideStageWrap");
        stageWrap.setAttribute("data-anim-seed", String(animSeed));
        stageWrap.setAttribute("data-card-style", currentCardStyle);
        stageWrap.innerHTML = applyGuideSvgTheme(getStepSvg(currentStep, currentLang));

        // Dots
        var dotsContainer = document.getElementById("guideDotsContainer");
        dotsContainer.innerHTML = stepsData
          .map(function (_, idx) {
            var activeClass = idx === currentStep ? "guide-dot active" : "guide-dot";
            var label = isEn ? "Go to step " + (idx + 1) : "跳转到第 " + (idx + 1) + " 步";
            return (
              '<button type="button" class="' +
              activeClass +
              '" data-step-idx="' +
              idx +
              '" aria-label="' +
              label +
              '"></button>'
            );
          })
          .join("");

        // Buttons
        var prevBtn = document.getElementById("guidePrevBtn");
        var nextBtn = document.getElementById("guideNextBtn");
        var skipBtn = document.getElementById("guideSkipBtn");

        prevBtn.disabled = currentStep === 0;
        prevBtn.textContent = isEn ? "Previous" : "上一步";
        skipBtn.textContent = isEn ? "Skip" : "跳过";

        if (currentStep === stepsData.length - 1) {
          nextBtn.textContent = isEn ? "Get Started" : "开始使用";
          skipBtn.style.visibility = "hidden";
        } else {
          nextBtn.textContent = isEn ? "Next" : "下一步";
          skipBtn.style.visibility = "visible";
        }
      }

      // Close the guide and record that the visitor has seen it.
      function closeGuide() {
        try {
          localStorage.setItem(STORAGE_KEY, "1");
        } catch (_err) {
          /* ignore storage quota / sandbox restrictions */
        }
        var backdrop = document.getElementById("guideBackdrop");
        if (backdrop) backdrop.classList.add("is-hidden");
        if (isEmbedded) {
          window.dispatchEvent(new CustomEvent("cf-navs:guide:close"));
        } else {
          window.location.assign(new URL("../", window.location.href).toString());
        }
      }

      // Open Guide
      function openGuide(resetToFirst) {
        if (resetToFirst) {
          currentStep = 0;
        }
        renderGuideStep();
        var backdrop = document.getElementById("guideBackdrop");
        if (backdrop) {
          backdrop.classList.remove("is-hidden");
        }
      }

      // Initialize Event Listeners
      function init() {
        applyGuideAppearance();
        renderGuideStep();
        if (!isEmbedded) document.getElementById("guideCloseBtn").focus();
        window.addEventListener("cf-navs:guide:open", function () {
          applyGuideAppearance();
          openGuide(true);
        });

        // Prev / Next / Skip / Close
        document.getElementById("guidePrevBtn").addEventListener("click", function () {
          if (currentStep > 0) {
            currentStep--;
            renderGuideStep();
          }
        });

        document.getElementById("guideNextBtn").addEventListener("click", function () {
          if (currentStep < stepsData.length - 1) {
            currentStep++;
            renderGuideStep();
          } else {
            closeGuide();
          }
        });

        document.getElementById("guideSkipBtn").addEventListener("click", closeGuide);
        document.getElementById("guideCloseBtn").addEventListener("click", closeGuide);

        // Backdrop Click to Close
        document.getElementById("guideBackdrop").addEventListener("click", function (e) {
          if (e.target === this) {
            closeGuide();
          }
        });

        // Step Dots Delegation
        document.getElementById("guideDotsContainer").addEventListener("click", function (e) {
          var btn = e.target.closest("[data-step-idx]");
          if (btn) {
            currentStep = parseInt(btn.getAttribute("data-step-idx"), 10);
            renderGuideStep();
          }
        });

        // Replay Animation Button
        document.getElementById("replayAnimBtn").addEventListener("click", function () {
          animSeed++;
          var stageWrap = document.getElementById("guideStageWrap");
          stageWrap.innerHTML = "";
          requestAnimationFrame(function () {
            stageWrap.innerHTML = applyGuideSvgTheme(getStepSvg(currentStep, currentLang));
          });
        });

        // Language Switcher [ 中文 | EN ]
        document.getElementById("langZhBtn").addEventListener("click", function () {
          currentLang = "zh";
          this.classList.add("active");
          document.getElementById("langEnBtn").classList.remove("active");
          renderGuideStep();
        });

        document.getElementById("langEnBtn").addEventListener("click", function () {
          currentLang = "en";
          this.classList.add("active");
          document.getElementById("langZhBtn").classList.remove("active");
          renderGuideStep();
        });

        // Keyboard Navigation (← / → / Esc / Ctrl+K)
        window.addEventListener("keydown", function (e) {
          var backdrop = document.getElementById("guideBackdrop");
          var isGuideOpen = backdrop && !backdrop.classList.contains("is-hidden");

          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            currentStep = 3;
            openGuide(false);
            return;
          }

          if (!isGuideOpen) return;

          if (e.key === "Escape") {
            e.preventDefault();
            closeGuide();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (currentStep < stepsData.length - 1) {
              currentStep++;
              renderGuideStep();
            }
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (currentStep > 0) {
              currentStep--;
              renderGuideStep();
            }
          }
        });

        // Touch Swipe Support on Mobile (NFR-02)
        var touchStartX = 0;
        var touchArea = document.getElementById("guideTouchArea");
        touchArea.addEventListener("touchstart", function (e) {
          if (e.touches && e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
          }
        }, { passive: true });

        touchArea.addEventListener("touchend", function (e) {
          if (!e.changedTouches || e.changedTouches.length === 0) return;
          var dx = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(dx) > 45) {
            if (dx < 0 && currentStep < stepsData.length - 1) {
              currentStep++;
              renderGuideStep();
            } else if (dx > 0 && currentStep > 0) {
              currentStep--;
              renderGuideStep();
            }
          }
        }, { passive: true });
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
      } else {
        init();
      }
    })();
