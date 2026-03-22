import { realpath as nodeRealpath } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import path from 'node:path'

type PathApi = Pick<typeof path, 'normalize' | 'isAbsolute'>
type ValidationMessage =
  | string
  | ((filePath: string, resolvedPath: string) => string)

interface FilePathValidationMessages {
  absolutePath?: ValidationMessage
  outsideAllowedRoots?: ValidationMessage
  sensitiveFile?: ValidationMessage
}

interface FilePathValidationOptions {
  allowedRoots?: string[]
  caseInsensitiveComparison?: boolean
  homeDir?: string
  messages?: FilePathValidationMessages
  pathApi?: PathApi
  realpathFn?: (filePath: string) => Promise<string>
  tempDir?: string
}

const DEFAULT_MESSAGES: Required<FilePathValidationMessages> = {
  absolutePath: 'Only absolute file paths are allowed',
  outsideAllowedRoots: 'Access denied: file path is outside allowed directories',
  sensitiveFile: 'Access denied: cannot read sensitive files',
}

const SENSITIVE_PATH_PATTERNS = [
  /\.ssh\//,
  /\.gnupg\//,
  /\.aws\/credentials/,
  /\.env$/,
  /\.env\./,
  /credentials\.json$/,
  /secrets?\./i,
  /\.pem$/,
  /\.key$/,
  /\.netrc$/,
  /\.kube\/config/,
  /\.config\/git\/credentials/,
  /credentials\.enc$/,
]

export async function validateAttachmentPath(
  filePath: string,
  options: FilePathValidationOptions = {},
): Promise<string> {
  return validateResolvedFilePath(filePath, {
    ...options,
    enforceAllowedRoots: false,
  })
}

export async function validateTrustedFileAccessPath(
  filePath: string,
  options: FilePathValidationOptions = {},
): Promise<string> {
  return validateResolvedFilePath(filePath, {
    ...options,
    enforceAllowedRoots: true,
  })
}

async function validateResolvedFilePath(
  filePath: string,
  options: FilePathValidationOptions & { enforceAllowedRoots: boolean },
): Promise<string> {
  const pathApi = options.pathApi ?? path
  const realpathFn = options.realpathFn ?? nodeRealpath
  const homeDir = options.homeDir ?? homedir()
  const tempDir = options.tempDir ?? tmpdir()

  let normalizedPath = pathApi.normalize(filePath)
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homeDir)
  }

  if (!pathApi.isAbsolute(normalizedPath)) {
    throw new Error(resolveMessage(
      options.messages?.absolutePath ?? DEFAULT_MESSAGES.absolutePath,
      filePath,
      normalizedPath,
    ))
  }

  let realFilePath: string
  try {
    realFilePath = await realpathFn(normalizedPath)
  } catch {
    realFilePath = normalizedPath
  }

  if (options.enforceAllowedRoots) {
    const caseInsensitiveComparison = getCaseInsensitiveComparison(pathApi, options.caseInsensitiveComparison)
    const allowedRoots = [
      homeDir,
      tempDir,
      ...(options.allowedRoots ?? []),
    ].filter(Boolean)

    const isAllowed = allowedRoots.some((rootPath) =>
      isPathWithinRoot(realFilePath, rootPath, {
        caseInsensitiveComparison,
        pathApi,
      }))

    if (!isAllowed) {
      throw new Error(resolveMessage(
        options.messages?.outsideAllowedRoots ?? DEFAULT_MESSAGES.outsideAllowedRoots,
        filePath,
        realFilePath,
      ))
    }
  }

  const pathForPatterns = normalizeForComparison(
    realFilePath,
    pathApi,
    getCaseInsensitiveComparison(pathApi, options.caseInsensitiveComparison),
  )

  if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(pathForPatterns))) {
    throw new Error(resolveMessage(
      options.messages?.sensitiveFile ?? DEFAULT_MESSAGES.sensitiveFile,
      filePath,
      realFilePath,
    ))
  }

  return realFilePath
}

function isPathWithinRoot(
  filePath: string,
  rootPath: string,
  options: {
    caseInsensitiveComparison: boolean
    pathApi: PathApi
  },
): boolean {
  const normalizedFilePath = normalizeForComparison(filePath, options.pathApi, options.caseInsensitiveComparison)
  const normalizedRootPath = trimTrailingSeparators(
    normalizeForComparison(rootPath, options.pathApi, options.caseInsensitiveComparison),
  )

  if (!normalizedRootPath) return false

  return normalizedFilePath === normalizedRootPath
    || normalizedFilePath.startsWith(`${normalizedRootPath}/`)
}

function trimTrailingSeparators(filePath: string): string {
  if (filePath === '/') return filePath
  return filePath.replace(/\/+$/, '')
}

function normalizeForComparison(
  filePath: string,
  pathApi: PathApi,
  caseInsensitiveComparison: boolean,
): string {
  const normalized = pathApi.normalize(filePath).replace(/\\/g, '/')
  return caseInsensitiveComparison ? normalized.toLowerCase() : normalized
}

function getCaseInsensitiveComparison(
  pathApi: PathApi,
  explicitValue: boolean | undefined,
): boolean {
  if (explicitValue != null) return explicitValue
  if (pathApi === path.win32) return true
  return pathApi === path && process.platform === 'win32'
}

function resolveMessage(
  message: ValidationMessage,
  filePath: string,
  resolvedPath: string,
): string {
  return typeof message === 'function' ? message(filePath, resolvedPath) : message
}
