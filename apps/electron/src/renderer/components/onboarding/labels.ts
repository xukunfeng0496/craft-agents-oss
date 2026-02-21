import type { TFunction } from 'i18next'

export function getWelcomeLabels(t: TFunction) {
  return {
    title: t('onboarding:welcome.title'),
    titleExisting: t('onboarding:welcome.titleExisting'),
    description: t('onboarding:welcome.description'),
    descriptionExisting: t('onboarding:welcome.descriptionExisting'),
    cta: t('onboarding:welcome.cta'),
    ctaExisting: t('onboarding:welcome.ctaExisting'),
    loading: t('onboarding:welcome.loading'),
  }
}

export function getReauthLabels(t: TFunction) {
  return {
    title: t('onboarding:reauth.title'),
    description: t('onboarding:reauth.description'),
    descriptionSecondary: t('onboarding:reauth.descriptionSecondary'),
    note: t('onboarding:reauth.note'),
    login: t('onboarding:reauth.login'),
    loggingIn: t('onboarding:reauth.loggingIn'),
    reset: t('onboarding:reauth.reset'),
    error: t('onboarding:reauth.error'),
  }
}

export function getApiSetupLabels(t: TFunction) {
  return {
    title: t('onboarding:apiSetup.title'),
    description: t('onboarding:apiSetup.description'),
    recommended: t('onboarding:apiSetup.recommended'),
    back: t('onboarding:apiSetup.back'),
    continue: t('onboarding:apiSetup.continue'),
  }
}

export function getMissingToolsLabels(t: TFunction) {
  return {
    title: t('onboarding:missingTools.title'),
    description: t('onboarding:missingTools.description'),
    continue: t('onboarding:missingTools.continue'),
    skip: t('onboarding:missingTools.skip'),
    back: t('onboarding:missingTools.back'),
    found: t('onboarding:missingTools.status.found'),
    missing: t('onboarding:missingTools.status.missing'),
    autoInstall: t('onboarding:missingTools.autoInstall'),
    manualInstall: t('onboarding:missingTools.manualInstall'),
    openDownloadPage: t('onboarding:missingTools.openDownloadPage'),
    recheck: t('onboarding:missingTools.recheck'),
    rechecking: t('onboarding:missingTools.rechecking'),
    installerLaunched: t('onboarding:missingTools.installerLaunched'),
    linuxNote: t('onboarding:missingTools.linux.note'),
    toolName: (id: 'git' | 'python') => t(`onboarding:missingTools.tools.${id}.name`),
    toolDescription: (id: 'git' | 'python') => t(`onboarding:missingTools.tools.${id}.description`),
  }
}

export function getCredentialsLabels(t: TFunction) {
  return {
    apiKeyInvalid: t('onboarding:credentials.apiKey.errors.invalid'),
    customModelDefaultHint: t('onboarding:credentials.apiKey.modelHelp.custom'),
    customModelLabel: t('onboarding:credentials.apiKey.modelLabel'),
    optional: t('onboarding:credentials.apiKey.optional'),
    customPreset: t('onboarding:credentials.apiKey.presets.custom'),
    nonClaudeHint: t('onboarding:credentials.apiKey.modelHelp.nonClaude'),
    formatPrefix: t('onboarding:credentials.apiKey.modelHelp.formatPrefix'),
    browseModels: t('onboarding:credentials.apiKey.modelHelp.browseModels'),
    viewSupportedModels: t('onboarding:credentials.apiKey.modelHelp.viewSupportedModels'),
    ollamaHint: t('onboarding:credentials.apiKey.modelHelp.ollama'),
    back: t('onboarding:credentials.actions.back'),
    continue: t('onboarding:credentials.actions.continue'),
  }
}
