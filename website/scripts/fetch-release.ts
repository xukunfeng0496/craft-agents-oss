/**
 * 构建时从 GitHub Releases API 获取最新版本信息
 * 并写入 src/data/release.json
 */

const REPO = 'xukunfeng0496/work-agents';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  htmlUrl: string;
  assets: {
    name: string;
    downloadUrl: string;
    size: number;
  }[];
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        // 如果有 GITHUB_TOKEN 环境变量，可以避免 API 限流
        ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    return {
      version: data.tag_name.replace(/^v/, ''),
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      assets: data.assets.map((a: any) => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        size: a.size,
      })),
    };
  } catch (error) {
    console.error('Failed to fetch release info:', error);
    return null;
  }
}

async function main() {
  console.log('Fetching latest release info from GitHub...');

  const release = await fetchLatestRelease();

  if (!release) {
    console.log('API unavailable, keeping existing release.json');
    // 保留现有数据，不覆盖
    try {
      const existing = await Bun.file('src/data/release.json').text();
      JSON.parse(existing); // 验证 JSON 有效
      console.log('Existing release.json is valid, skipping update.');
    } catch {
      // 文件不存在或无效，写入默认值
      const defaultRelease: ReleaseInfo = {
        version: '0.5.3',
        publishedAt: new Date().toISOString(),
        htmlUrl: `https://github.com/${REPO}/releases/latest`,
        assets: [],
      };
      await Bun.write('src/data/release.json', JSON.stringify(defaultRelease, null, 2));
    }
    return;
  }

  console.log(`Latest version: ${release.version}`);

  // 确保 data 目录存在
  await Bun.write('src/data/.gitkeep', '');

  await Bun.write(
    'src/data/release.json',
    JSON.stringify(release, null, 2)
  );

  console.log('Release info written to src/data/release.json');
}

main();
