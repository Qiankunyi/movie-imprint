export const TAG_LOCALES = ["zh-Hans", "zh-Hant", "en", "ja"];

const COPY = {
  "zh-Hans": {
    index: "标签索引", search: "搜索标签", frequent: "常用标签", creators: "创作者", personal: "个人标签",
    empty: "还没有标签。给作品添加标签，或在感想中写下 #标签。", noResults: "没有找到匹配的标签。",
    works: "相关作品", viewings: "相关观影记录", director: "导演", sourceBangumi: "Bangumi",
    overview: "概览", attitude: "态度分布", sortAttitude: "我的态度", sortRecent: "最近观看", sortRelease: "上映年代",
    add: "添加标签", edit: "管理标签", save: "保存", merge: "合并标签", delete: "删除标签", unlink: "取消关联",
    hidden: "隐藏", pinned: "固定", namePlaceholder: "输入标签名，用逗号或回车分隔"
  },
  "zh-Hant": {
    index: "標籤索引", search: "搜尋標籤", frequent: "常用標籤", creators: "創作者", personal: "個人標籤",
    empty: "還沒有標籤。為作品加入標籤，或在感想中寫下 #標籤。", noResults: "沒有找到符合的標籤。",
    works: "相關作品", viewings: "相關觀影記錄", director: "導演", sourceBangumi: "Bangumi",
    overview: "概覽", attitude: "態度分布", sortAttitude: "我的態度", sortRecent: "最近觀看", sortRelease: "上映年代",
    add: "加入標籤", edit: "管理標籤", save: "儲存", merge: "合併標籤", delete: "刪除標籤", unlink: "取消關聯",
    hidden: "隱藏", pinned: "固定", namePlaceholder: "輸入標籤名，以逗號或換行分隔"
  },
  en: {
    index: "Tag index", search: "Search tags", frequent: "Frequent tags", creators: "Creators", personal: "Personal tags",
    empty: "No tags yet. Add one to a work or write a #tag in an impression.", noResults: "No matching tags.",
    works: "Related works", viewings: "Related viewings", director: "Director", sourceBangumi: "Bangumi",
    overview: "Overview", attitude: "Attitude distribution", sortAttitude: "My attitude", sortRecent: "Recently watched", sortRelease: "Release era",
    add: "Add tags", edit: "Manage tags", save: "Save", merge: "Merge tags", delete: "Delete tag", unlink: "Unlink",
    hidden: "Hidden", pinned: "Pinned", namePlaceholder: "Enter tag names separated by commas or new lines"
  },
  ja: {
    index: "タグ索引", search: "タグを検索", frequent: "よく使うタグ", creators: "クリエイター", personal: "個人タグ",
    empty: "タグはまだありません。作品に追加するか、感想に #タグ を書いてください。", noResults: "一致するタグがありません。",
    works: "関連作品", viewings: "関連する鑑賞記録", director: "監督", sourceBangumi: "Bangumi",
    overview: "概要", attitude: "評価の分布", sortAttitude: "自分の評価", sortRecent: "最近の鑑賞", sortRelease: "公開年代",
    add: "タグを追加", edit: "タグを管理", save: "保存", merge: "タグを統合", delete: "タグを削除", unlink: "関連を解除",
    hidden: "非表示", pinned: "固定", namePlaceholder: "タグ名をカンマまたは改行で区切って入力"
  }
};

export function normalizeTagLocale(value = "") {
  const locale = String(value).replace("_", "-").toLowerCase();
  if (locale.startsWith("zh-hant") || locale === "zh-tw" || locale === "zh-hk") return "zh-Hant";
  if (locale.startsWith("zh")) return "zh-Hans";
  if (locale.startsWith("ja")) return "ja";
  if (locale.startsWith("en")) return "en";
  return "zh-Hans";
}

export function tagT(locale, key) {
  return COPY[normalizeTagLocale(locale)]?.[key] || COPY["zh-Hans"][key] || key;
}

