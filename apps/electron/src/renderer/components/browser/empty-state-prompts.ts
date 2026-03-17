import type { BrowserEmptyPromptSample } from '@work-agent/ui'

export const EMPTY_STATE_PROMPT_SAMPLES: readonly BrowserEmptyPromptSample[] = [
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
    short: '京东：办公显示器选购对比',
    full: '使用浏览器访问 https://www.jd.com ，搜索 27 英寸办公显示器，筛选 6 个适合办公和轻度设计的型号，并按价格、分辨率、色域和接口做对比。',
  },
] as const
