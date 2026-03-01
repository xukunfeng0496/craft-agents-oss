import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { getBundledGitPath, getBundledPythonPath, getBundledToolPath } from '../bundled-tools';

describe('bundled-tools', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      // Mock Windows platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });
    });

    it('getBundledGitPath returns git.exe path', () => {
      const gitPath = getBundledGitPath();

      if (gitPath) {
        expect(gitPath).toContain('resources');
        expect(gitPath).toContain('tools');
        expect(gitPath).toContain('mingit');
        expect(gitPath).toEndWith('git.exe');
      } else {
        // In test environment without Electron, it's ok to return null
        expect(gitPath).toBeNull();
      }
    });

    it('getBundledPythonPath returns python.exe path', () => {
      const pythonPath = getBundledPythonPath();

      if (pythonPath) {
        expect(pythonPath).toContain('resources');
        expect(pythonPath).toContain('tools');
        expect(pythonPath).toContain('python');
        expect(pythonPath).toEndWith('python.exe');
      } else {
        // In test environment without Electron, it's ok to return null
        expect(pythonPath).toBeNull();
      }
    });

    it('getBundledToolPath works for git', () => {
      const gitPath = getBundledToolPath('git');
      const directGitPath = getBundledGitPath();

      expect(gitPath).toBe(directGitPath);
    });

    it('getBundledToolPath works for python', () => {
      const pythonPath = getBundledToolPath('python');
      const directPythonPath = getBundledPythonPath();

      expect(pythonPath).toBe(directPythonPath);
    });

    it('getBundledToolPath returns null for unknown tool', () => {
      const unknownPath = getBundledToolPath('unknown' as any);

      expect(unknownPath).toBeNull();
    });
  });

  describe('on non-Windows platforms', () => {
    beforeEach(() => {
      // Mock macOS platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });
    });

    it('getBundledGitPath returns null', () => {
      const gitPath = getBundledGitPath();
      expect(gitPath).toBeNull();
    });

    it('getBundledPythonPath returns null', () => {
      const pythonPath = getBundledPythonPath();
      expect(pythonPath).toBeNull();
    });

    it('getBundledToolPath returns null', () => {
      const gitPath = getBundledToolPath('git');
      const pythonPath = getBundledToolPath('python');

      expect(gitPath).toBeNull();
      expect(pythonPath).toBeNull();
    });
  });
});
