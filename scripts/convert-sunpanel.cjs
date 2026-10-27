#!/usr/bin/env node

/**
 * Sun-Panel 数据转换脚本
 * 将 Sun-Panel 导出的 JSON 转换为 CF-Navs 可导入的格式。
 *
 * 用法: node scripts/convert-sunpanel.cjs <sun-panel-export.json> <output.json>
 */

const fs = require('fs');

// 获取命令行参数
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node scripts/convert-sunpanel.cjs <sun-panel-export.json> <output.json>');
  console.error('示例: node scripts/convert-sunpanel.cjs sun-panel-data.json cf-navs-import.json');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1];

// 检查输入文件是否存在
if (!fs.existsSync(inputFile)) {
  console.error(`错误: 输入文件不存在: ${inputFile}`);
  process.exit(1);
}

console.log(`读取 Sun-Panel 数据: ${inputFile}`);

// 读取并解析 Sun-Panel 数据
let sunPanelData;
try {
  const content = fs.readFileSync(inputFile, 'utf-8');
  sunPanelData = JSON.parse(content);
} catch (error) {
  console.error('错误: 无法解析 JSON 文件:', error.message);
  process.exit(1);
}

// 转换函数
function convertSunPanelToCFNavs(sunPanelData) {
  const categories = [];
  const bookmarks = [];
  const now = Date.now();

  // 遍历 Sun-Panel 的 icons 数组（分类）
  if (!sunPanelData.icons || !Array.isArray(sunPanelData.icons)) {
    console.error('错误: 数据格式不正确，缺少 icons 数组');
    return null;
  }

  sunPanelData.icons.forEach((category, categoryIndex) => {
    // 创建分类
    const cfCategory = {
      id: categoryIndex + 1,
      title: category.title || '未命名分类',
      icon: null,
      sort: Number.isFinite(category.sort) ? category.sort : categoryIndex,
      created_at: now
    };
    categories.push(cfCategory);

    // 遍历该分类下的书签
    if (category.children && Array.isArray(category.children)) {
      category.children.forEach((item, itemIndex) => {
        // 提取图标
        let icon = '';
        if (item.icon) {
          if (item.icon.src) {
            // 如果是相对路径，需要转换为绝对路径或使用 favicon 服务
            if (item.icon.src.startsWith('http')) {
              icon = item.icon.src;
            } else if (item.icon.src.startsWith('/uploads/')) {
              // Sun-Panel 上传的图标，无法直接使用，留空让 CF-Navs 自动获取
              icon = '';
            } else {
              icon = item.icon.src;
            }
          } else if (item.icon.text && item.icon.itemType === 1) {
            // 文本图标，CF-Navs 不支持，留空
            icon = '';
          } else if (item.icon.itemType === 3) {
            // Iconify 图标，CF-Navs 不支持，留空
            icon = '';
          }
        }

        // 如果没有图标，尝试从 URL 自动获取
        if (!icon && item.url) {
          try {
            const urlObj = new URL(item.url);
            icon = `https://favicon.im/${urlObj.hostname}?larger=true`;
          } catch {
            icon = '';
          }
        }

        // 转换 openMethod: Sun-Panel 的 2 表示新窗口，1 表示当前窗口
        const openMethod = item.openMethod === 1 ? 2 : 1;

        const cfBookmark = {
          id: itemIndex + 1 + (categoryIndex * 1000), // 简单的 ID 生成策略
          category_id: cfCategory.id,
          title: item.title || '未命名书签',
          url: item.url || '',
          icon: icon || null,
          icon_source: null,
          description: item.description || null,
          open_method: openMethod,
          sort: Number.isFinite(item.sort) ? item.sort : itemIndex,
          created_at: now
        };

        bookmarks.push(cfBookmark);
      });
    }
  });

  return {
    version: 1,
    exported_at: now,
    source: 'Sun-Panel',
    categories,
    bookmarks
  };
}

// 执行转换
console.log('开始转换数据...');
const cfNavsData = convertSunPanelToCFNavs(sunPanelData);

if (!cfNavsData) {
  console.error('转换失败');
  process.exit(1);
}

console.log(`转换完成:`);
console.log(`  - 分类数量: ${cfNavsData.categories.length}`);
console.log(`  - 书签数量: ${cfNavsData.bookmarks.length}`);

// 写入输出文件
try {
  fs.writeFileSync(outputFile, JSON.stringify(cfNavsData, null, 2), 'utf-8');
  console.log(`\n已保存到: ${outputFile}`);
  console.log(`\n下一步:`);
  console.log(`1. 登录 CF-Navs 后台`);
  console.log(`2. 进入"数据管理"标签`);
  console.log(`3. 点击"导入备份"并选择 ${outputFile}`);
  console.log(`4. 确认导入`);
} catch (error) {
  console.error('错误: 无法写入输出文件:', error.message);
  process.exit(1);
}
