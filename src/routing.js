/**
 * R4 · 路由：home / shelf / work / detail 四视图的纯状态转移。
 *
 * 纯函数模块，不接触 DOM／history API／数据库——src/app.js 负责把这里算出的下一个
 * route 同步到地址栏（pushState/popstate）与实际滚动位置，这里只定义"从哪来、回哪去、
 * 各自的滚动位置记多少"这套规则本身，方便在 Node 里直接测试，不依赖浏览器环境。
 *
 * 返回路径：detail ← work ← shelf ← home，以及 detail ← home（从时间线直接进入时）。
 * 书架与作品页各自维护自己的滚动位置；从 detail 返回时，按"当初从哪个视图进入"决定
 * 回到哪个视图，并恢复该视图当时保存的滚动位置。
 */

export const VIEWS = ["home", "shelf", "work", "detail"];

/**
 * 初始路由：首页，三个视图的滚动位置都是 0。
 * @returns {{ view: string, currentWorkId: string|null, activeRecordId: string|null,
 *   detailReturnView: "home"|"work", scroll: { home: number, shelf: number, work: number } }}
 */
export function createRoute() {
  return {
    view: "home",
    currentWorkId: null,
    activeRecordId: null,
    detailReturnView: "home",
    scroll: { home: 0, shelf: 0, work: 0 }
  };
}

function withScroll(route, view, scrollY) {
  if (typeof scrollY !== "number" || Number.isNaN(scrollY)) return route;
  return { ...route, scroll: { ...route.scroll, [view]: scrollY } };
}

/**
 * 首页 → 作品书架。保存离开首页时的滚动位置，回来时才能恢复。
 * @param {object} route
 * @param {{ scrollY?: number }} [options]
 */
export function enterShelf(route, { scrollY } = {}) {
  return { ...withScroll(route, "home", scrollY), view: "shelf" };
}

/** 作品书架 → 首页。 */
export function exitShelf(route) {
  return { ...route, view: "home" };
}

/**
 * 作品书架 → 作品页。保存离开书架时的滚动位置。
 * @param {object} route
 * @param {string} workId
 * @param {{ scrollY?: number }} [options]
 */
export function enterWork(route, workId, { scrollY } = {}) {
  return { ...withScroll(route, "shelf", scrollY), view: "work", currentWorkId: workId };
}

/** 作品页 → 作品书架（作品页在本窗口只能从书架进入，所以固定回书架）。 */
export function exitWork(route) {
  return { ...route, view: "shelf", currentWorkId: null };
}

/**
 * 进入感想详情。detailReturnView 记录"从时间线还是从作品页进来的"，决定返回路径。
 * 同时把离开那个视图（home 或 work）的滚动位置存起来。
 * @param {object} route
 * @param {string} recordId
 * @param {{ scrollY?: number }} [options]
 */
export function enterRecord(route, recordId, { scrollY } = {}) {
  const fromView = route.view === "work" ? "work" : "home";
  return { ...withScroll(route, fromView, scrollY), view: "detail", activeRecordId: recordId, detailReturnView: fromView };
}

/** 感想详情 → 按 detailReturnView 回到时间线或作品页。 */
export function exitRecord(route) {
  const backView = route.detailReturnView === "work" ? "work" : "home";
  return { ...route, view: backView, activeRecordId: null };
}

/** 任意视图直接回时间线（例如抽屉里点"时间线"、或详情页从时间线进入时返回）。 */
export function goHome(route) {
  return { ...route, view: "home", currentWorkId: null, activeRecordId: null };
}

/**
 * 某个视图应当恢复到的滚动位置。
 * @param {object} route
 * @param {string} [view] 默认取 route.view 本身
 * @returns {number}
 */
export function scrollFor(route, view = route.view) {
  return route.scroll[view] ?? 0;
}
