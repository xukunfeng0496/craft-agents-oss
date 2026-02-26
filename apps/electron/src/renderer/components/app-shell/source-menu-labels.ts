import type { TFunction } from 'i18next'

const isWindows =
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('win')

export function getSourceMenuLabels(t: TFunction) {
  return {
    openInNewWindow: t('common:menu.openInNewWindow'),
    showInFinder: t(isWindows ? 'common:menu.showInExplorer' : 'common:menu.showInFinder'),
    deleteSource: t('common:menu.deleteSource'),
  }
}
