export interface LocateOpts {
  platform?: NodeJS.Platform;
  arch?: string;
  /** 仓库根（默认从本文件向上推 4 层：test/e2e/lib → repo 根）。*/
  repoRoot?: string;
  /** Windows 用，覆盖 %LOCALAPPDATA%（测试注入）。*/
  localAppData?: string;
}

function defaultRepoRoot(): string {
  // test/e2e/lib/app-locate.ts → ../../../.. = repo 根
  return new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
}

/** 定位打包 app 的可执行二进制（不存在也返回路径——由 sandbox 启动时报错）。*/
export function locateApp(opts: LocateOpts = {}): string {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();

  if (platform === 'darwin') {
    const dir = arch === 'arm64' ? 'mac-arm64' : 'mac';
    return `${repoRoot}/apps/electron/release/${dir}/Work Agents.app/Contents/MacOS/Work Agents`;
  }
  if (platform === 'win32') {
    const lad = opts.localAppData ?? process.env.LOCALAPPDATA ?? '';
    return `${lad}/Programs/work-agents/Work Agents.exe`;
  }
  throw new Error(`unsupported platform for e2e: ${platform}`);
}
