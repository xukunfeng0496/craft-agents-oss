/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and an optional Model override field.
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react"
import { ModelSelector, type PresetModel } from "@/components/settings/ModelSelector"

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  connectionDefaultModel?: string
  models?: string[]
}

export interface ApiKeyInputProps {
  /** Current validation status */
  status: ApiKeyStatus
  /** Error message to display when status is 'error' */
  errorMessage?: string
  /** Called when the form is submitted with the key and optional endpoint config */
  onSubmit: (data: ApiKeySubmitData) => void
  /** Form ID for external submit button binding (default: "api-key-form") */
  formId?: string
  /** Disable the input (e.g. during validation) */
  disabled?: boolean
  /** Provider type determines which presets and placeholders to show */
  providerType?: 'anthropic' | 'openai'
  /** Localized helper text for custom model default behavior */
  customModelDefaultHint?: string
  /** Localized helper text for non-Claude model guidance */
  nonClaudeHint?: string
  /** Localized helper prefix for model format */
  modelFormatPrefix?: string
  /** Localized link label for OpenRouter models */
  browseModelsLabel?: string
  /** Localized link label for provider supported models */
  viewSupportedModelsLabel?: string
  /** Localized helper text for Ollama model guidance */
  ollamaHint?: string
  /** Localized label for model field */
  customModelLabel?: string
  /** Localized text for optional marker */
  optionalLabel?: string
  /** Localized text for custom preset */
  customPresetLabel?: string
}

// Preset key includes both provider defaults ('anthropic', 'openai') and third-party services
type PresetKey = 'anthropic' | 'openai' | 'openrouter' | 'vercel' | 'ollama' | 'custom'

interface Preset {
  key: PresetKey
  label: string
  url: string
}

// Anthropic provider presets - for Claude Code backend
const ANTHROPIC_PRESETS: Preset[] = [
  { key: 'custom', label: 'Custom', url: '' },
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh' },
  { key: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
]

export function getPresetTriggerLabel(activePreset: PresetKey, customPresetLabel?: string): string {
  const selected = ANTHROPIC_PRESETS.find((p) => p.key === activePreset)
  if (!selected) return ANTHROPIC_PRESETS[0].label
  if (selected.key === 'custom') return customPresetLabel ?? selected.label
  return selected.label
}

const PRESETS = ANTHROPIC_PRESETS

// OpenAI provider presets - for Codex backend
// Only direct OpenAI is supported; 3PP providers (OpenRouter, Vercel, Ollama) should be
// configured via the Anthropic/Claude connection which routes through the Claude Agent SDK.
const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
]

const COMPAT_ANTHROPIC_DEFAULTS = 'anthropic/claude-opus-4.6, anthropic/claude-sonnet-4.5, anthropic/claude-haiku-4.5'
const COMPAT_OPENAI_DEFAULTS = 'openai/gpt-5.2-codex, openai/gpt-5.1-codex-mini'

function getPresetsForProvider(providerType: 'anthropic' | 'openai'): Preset[] {
  return providerType === 'openai' ? OPENAI_PRESETS : ANTHROPIC_PRESETS
}

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  providerType = 'anthropic',
  customModelDefaultHint,
  nonClaudeHint,
  modelFormatPrefix,
  browseModelsLabel,
  viewSupportedModelsLabel,
  ollamaHint,
  customModelLabel,
  optionalLabel,
  customPresetLabel,
}: ApiKeyInputProps) {
  // Get presets based on provider type
  const presets = getPresetsForProvider(providerType)
  const defaultPreset = presets[0]

  const { t } = useTranslation(['settings'])
  const [apiKey, setApiKey] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(defaultPreset.key)
  const [connectionDefaultModel, setConnectionDefaultModel] = useState('')
  const [modelError, setModelError] = useState<string | null>(null)

  // ModelSelector state for compat endpoints (multi-select)
  const presetModelDefs = useMemo((): PresetModel[] => [
    { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', description: t('settings:ai.model.presetClaudeSonnet') },
    { id: 'glm-5', label: 'glm-5', description: t('settings:ai.model.presetGlm') },
  ], [t])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set([presetModelDefs[0].id]))
  const [customModels, setCustomModels] = useState<string[]>([])

  // Sync ModelSelector multi-select state → connectionDefaultModel string for form submission
  const syncModelsToString = useCallback((selected: Set<string>, customs: string[]) => {
    const ordered = Array.from(selected)
    setConnectionDefaultModel(ordered.join(', '))
    setModelError(null)
  }, [])

  const handleSelectedModelsChange = useCallback((models: Set<string>) => {
    setSelectedModels(models)
    syncModelsToString(models, customModels)
  }, [customModels, syncModelsToString])

  const handleCustomModelsChange = useCallback((models: string[]) => {
    setCustomModels(models)
    syncModelsToString(selectedModels, models)
  }, [selectedModels, syncModelsToString])

  const isDisabled = disabled || status === 'validating'

  // Determine if we're using the default provider preset (hide base URL field)
  const isDefaultProviderPreset = activePreset === 'anthropic' || activePreset === 'openai'

  // Provider-specific placeholders
  const apiKeyPlaceholder = providerType === 'openai' ? 'sk-...' : 'sk-ant-...'

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    setModelError(null)
    // Pre-fill recommended model for Ollama; for compat presets reset to ModelSelector defaults
    if (preset.key === 'ollama') {
      setConnectionDefaultModel('qwen3-coder')
      setCustomModels([])
      setSelectedModels(new Set(['qwen3-coder']))
    } else if (preset.key === 'anthropic' || preset.key === 'openai') {
      // Default provider presets - clear model field
      setConnectionDefaultModel('')
      setCustomModels([])
      setSelectedModels(new Set([presetModelDefs[0].id]))
    } else {
      // Compat presets (openrouter, vercel, custom) - select all presets by default
      const allPresetIds = presetModelDefs.map(m => m.id)
      setSelectedModels(new Set(allPresetIds))
      setCustomModels([])
      setConnectionDefaultModel(allPresetIds.join(', '))
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    const presetKey = getPresetForUrl(value, presets)
    setActivePreset(presetKey)
    setModelError(null)
    // Only set defaults when no models are configured yet
    if (!connectionDefaultModel.trim()) {
      if (presetKey === 'ollama') {
        setConnectionDefaultModel('qwen3-coder')
        setSelectedModels(new Set(['qwen3-coder']))
        setCustomModels([])
      } else if (presetKey !== 'anthropic' && presetKey !== 'openai') {
        const allPresetIds = presetModelDefs.map(m => m.id)
        setSelectedModels(new Set(allPresetIds))
        setCustomModels([])
        setConnectionDefaultModel(allPresetIds.join(', '))
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Always call onSubmit — the hook decides whether an empty key is valid
    // (custom endpoints like Ollama don't require API keys)
    const effectiveBaseUrl = baseUrl.trim()
    const parsedModels = parseModelList(connectionDefaultModel)
    const requiresModel = !isDefaultProviderPreset && !!effectiveBaseUrl
    if (requiresModel && parsedModels.length === 0) {
      setModelError('Default model is required for compatible endpoints.')
      return
    }
    // For default provider presets, don't pass a baseUrl (use provider's default)
    const isDefault = isDefaultProviderPreset || !effectiveBaseUrl
    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isDefault ? undefined : effectiveBaseUrl,
      connectionDefaultModel: parsedModels[0],
      models: parsedModels.length > 0 ? parsedModels : undefined,
    })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key */}
      <div className="space-y-2">
        <Label htmlFor="api-key">API Key</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="api-key"
            type={showValue ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Endpoint Preset Selector - hidden when only one preset (e.g. Codex/OpenAI direct) */}
      {presets.length > 1 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">Endpoint</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {getPresetTriggerLabel(activePreset, customPresetLabel)}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {presets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  {preset.key === 'custom' ? (customPresetLabel ?? preset.label) : preset.label}
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Base URL input - hidden for default provider presets (Anthropic/OpenAI) */}
        {!isDefaultProviderPreset && (
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://your-api-endpoint.com"
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
        )}
      </div>
      )}

      {/* Model selection — hidden for default provider presets since they use their own model routing */}
      {!isDefaultProviderPreset && (
        <div className="space-y-2">
          <Label className="text-muted-foreground font-normal">
            {customModelLabel ?? 'Default Model'}{' '}
            <span className="text-foreground/30">
              · {(!isDefaultProviderPreset && baseUrl.trim()) ? 'required' : (optionalLabel ?? 'optional')}
            </span>
          </Label>
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
          <div className={cn(
            "rounded-lg border border-border/50",
            modelError && "ring-1 ring-destructive/40"
          )}>
            <ModelSelector
              selectedModels={selectedModels}
              onSelectedModelsChange={handleSelectedModelsChange}
              presetModels={presetModelDefs}
              customModels={customModels}
              onCustomModelsChange={handleCustomModelsChange}
              showLabel={false}
              disabled={isDisabled}
            />
          </div>
          <p className="text-xs text-foreground/30">
            {t('settings:ai.model.description')}
          </p>
        </div>
      )}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
