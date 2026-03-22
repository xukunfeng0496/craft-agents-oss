import type { BrowserEmptyPromptSample } from '@work-agent/ui'

const PROMPTS_ZH_CN: readonly BrowserEmptyPromptSample[] = [
  {
    short: '36 氪：整理今天 AI / 科技热点',
    full: '使用浏览器打开 https://36kr.com ，整理今天最值得关注的 10 条 AI / 科技热点，输出表格，包含标题、来源、发布时间和一句话看点。',
  },
  {
    short: '少数派：筛选效率工具好文',
    full: '使用浏览器访问 https://sspai.com ，筛选最近值得收藏的 5 篇效率工具或工作流文章，并总结适合哪些人、核心观点和可直接照抄的做法。',
  },
  {
    short: '掘金：本周热门前端 / AI 工程文章',
    full: '使用浏览器访问 https://juejin.cn ，整理本周热门的前端或 AI 工程相关文章 8 篇，按实战价值排序，并给出每篇文章适合阅读的人群。',
  },
  {
    short: 'B 站：热门 AI 编程视频清单',
    full: '使用浏览器访问 https://www.bilibili.com ，搜索 AI 编程或 Cursor / Copilot / Claude Code 相关内容，整理 8 个高热度视频，列出标题、UP 主、时长和推荐理由。',
  },
  {
    short: '中国政府网：最近 5 条国务院政策动态',
    full: '使用浏览器访问 https://www.gov.cn ，收集最近 5 条国务院政策或政务动态，列出标题、日期、发布机构和一句话摘要。',
  },
  {
    short: '国家统计局：最新宏观数据摘要',
    full: '使用浏览器访问 https://www.stats.gov.cn ，查找最近一期 CPI、PPI 和社会消费品零售总额数据，整理成简明摘要，并解释这些指标对消费和企业经营的含义。',
  },
  {
    short: '东方财富：A 股市场状态快照',
    full: '使用浏览器访问 https://www.eastmoney.com ，整理今天 A 股三大指数、成交额、涨跌家数和最活跃板块，输出一份适合日会汇报的市场快照。',
  },
  {
    short: '中国天气网：北上广深天气对比',
    full: '使用浏览器访问 https://www.weather.com.cn ，对比北京、上海、广州、深圳未来 3 天的天气、温度区间和降雨情况，并给出出行建议。',
  },
  {
    short: '小米 / 华为：旗舰手机参数对比',
    full: '使用浏览器访问 https://www.mi.com 和 https://consumer.huawei.com/cn/phones/ ，挑选两款在售旗舰手机，整理参数对比表，包含芯片、屏幕、影像、续航和价格。',
  },
  {
    short: '京东：办公显��器选购对比',
    full: '使用浏览器访问 https://www.jd.com ，搜索 27 英寸办公显示器，筛选 6 个适合办公和轻度设计的型号，并按价格、分辨率、色域和接口做对比。',
  },
] as const

const PROMPTS_EN: readonly BrowserEmptyPromptSample[] = [
  {
    short: 'Hacker News: Top AI/tech stories today',
    full: 'Open https://news.ycombinator.com in the browser and compile the top 10 AI/tech stories today into a table with title, source, time posted, and a one-line takeaway.',
  },
  {
    short: 'TechCrunch: Latest startup funding rounds',
    full: 'Visit https://techcrunch.com in the browser and list the 5 most recent startup funding announcements, including company name, round size, investors, and what the company does.',
  },
  {
    short: 'GitHub Trending: Top repos this week',
    full: 'Visit https://github.com/trending in the browser and summarize the top 8 trending repositories this week, including name, language, stars gained, and a brief description.',
  },
  {
    short: 'Product Hunt: Today\'s top launches',
    full: 'Visit https://www.producthunt.com in the browser and list today\'s top 5 product launches with name, tagline, upvote count, and what problem each solves.',
  },
  {
    short: 'Reuters: Latest world news summary',
    full: 'Visit https://www.reuters.com in the browser and compile the 5 most important world news stories right now, with headline, region, and a one-paragraph summary each.',
  },
  {
    short: 'Weather: Major cities forecast comparison',
    full: 'Visit https://weather.com in the browser and compare the 3-day weather forecast for New York, London, Tokyo, and Sydney, including temperature range, conditions, and travel tips.',
  },
  {
    short: 'Amazon: Office monitor comparison',
    full: 'Visit https://www.amazon.com in the browser, search for 27-inch office monitors, and compare 6 models suitable for office work by price, resolution, color gamut, and connectivity.',
  },
  {
    short: 'Stack Overflow: Hot questions in AI/ML',
    full: 'Visit https://stackoverflow.com in the browser and find the 5 hottest questions tagged with AI or machine learning this week, summarizing each question and the top answer.',
  },
  {
    short: 'MDN: Latest web platform updates',
    full: 'Visit https://developer.mozilla.org in the browser and list the 5 most recent web platform feature updates or new APIs, with browser support status and use cases.',
  },
  {
    short: 'Apple vs Samsung: Flagship phone specs',
    full: 'Visit https://www.apple.com and https://www.samsung.com in the browser, pick the latest flagship phone from each, and create a comparison table covering chipset, display, camera, battery, and price.',
  },
] as const

/**
 * Returns locale-appropriate prompt samples for the browser empty state.
 */
export function getEmptyStatePromptSamples(language: string): readonly BrowserEmptyPromptSample[] {
  if (language.startsWith('zh')) return PROMPTS_ZH_CN
  return PROMPTS_EN
}

/** @deprecated Use getEmptyStatePromptSamples(language) instead */
export const EMPTY_STATE_PROMPT_SAMPLES = PROMPTS_ZH_CN
