import type { TFunction } from 'i18next'
import { isWindows } from '@/lib/platform'

export function getSourceMenuLabels(t: TFunction) {
  return {
    openInNewWindow: t('common:menu.openInNewWindow'),
    showInFinder: t(isWindows ? 'common:menu.showInExplorer' : 'common:menu.showInFinder'),
    deleteSource: t('common:menu.deleteSource'),
  }
}
