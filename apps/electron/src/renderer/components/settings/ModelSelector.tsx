/**
 * ModelSelector
 *
 * Rich model selection UI for compat/custom API connections.
 * Shows preset model recommendations with descriptions, supports adding
 * custom model IDs, and per-model validation via real API requests.
 *
 * Models are multi-select (checkbox). The first selected model becomes the default.
 * When `connectionSlug` is provided, validation buttons appear.
 * When omitted (e.g. in the onboarding wizard before saving), validation is hidden.
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, X, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ModelValidationState = 'idle' | 'validating' | 'success' | 'error'

interface ModelValidation {
  state: ModelValidationState
  error?: string
}

export interface PresetModel {
  id: string
  label: string
  description: string
}

export interface ModelSelectorProps {
  /** Connection slug for validation. When omitted, validation buttons are hidden. */
  connectionSlug?: string
  /** Set of currently selected model IDs */
  selectedModels: Set<string>
  /** Called when the selected models change */
  onSelectedModelsChange: (models: Set<string>) => void
  presetModels: PresetModel[]
  customModels: string[]
  onCustomModelsChange: (models: string[]) => void
  /** Whether to show the label header (default true, set false when parent provides label) */
  showLabel?: boolean
  /** Whether to disable interactions */
  disabled?: boolean
}

export function ModelSelector({
  connectionSlug,
  selectedModels,
  onSelectedModelsChange,
  presetModels,
  customModels,
  onCustomModelsChange,
  showLabel = true,
  disabled = false,
}: ModelSelectorProps) {
  const { t } = useTranslation(['settings'])
  const [validationStates, setValidationStates] = useState<Record<string, ModelValidation>>({})
  const [newModelId, setNewModelId] = useState('')

  const canValidate = !!connectionSlug

  const toggleModel = useCallback((modelId: string) => {
    const next = new Set(selectedModels)
    if (next.has(modelId)) {
      // Don't allow deselecting the last model
      if (next.size > 1) {
        next.delete(modelId)
      }
    } else {
      next.add(modelId)
    }
    onSelectedModelsChange(next)
  }, [selectedModels, onSelectedModelsChange])

  const validateModel = useCallback(async (modelId: string) => {
    if (!window.electronAPI || !connectionSlug) return
    setValidationStates(prev => ({ ...prev, [modelId]: { state: 'validating' } }))

    try {
      const result = await window.electronAPI.testLlmConnectionModel(connectionSlug, modelId)
      if (result.success) {
        setValidationStates(prev => ({ ...prev, [modelId]: { state: 'success' } }))
        setTimeout(() => {
          setValidationStates(prev => ({ ...prev, [modelId]: { state: 'idle' } }))
        }, 5000)
      } else {
        setValidationStates(prev => ({ ...prev, [modelId]: { state: 'error', error: result.error } }))
      }
    } catch {
      setValidationStates(prev => ({ ...prev, [modelId]: { state: 'error', error: 'Validation failed' } }))
    }
  }, [connectionSlug])

  const handleValidateAll = useCallback(async () => {
    const allModels = [
      ...presetModels.map(m => m.id),
      ...customModels,
    ]
    for (const modelId of allModels) {
      await validateModel(modelId)
    }
  }, [presetModels, customModels, validateModel])

  const handleAddCustomModel = useCallback(() => {
    const trimmed = newModelId.trim()
    if (!trimmed) return
    // Don't add duplicates
    const allIds = [...presetModels.map(m => m.id), ...customModels]
    if (allIds.includes(trimmed)) return
    onCustomModelsChange([...customModels, trimmed])
    // Auto-select the newly added model
    const next = new Set(selectedModels)
    next.add(trimmed)
    onSelectedModelsChange(next)
    setNewModelId('')
  }, [newModelId, presetModels, customModels, onCustomModelsChange, selectedModels, onSelectedModelsChange])

  const handleRemoveCustomModel = useCallback((modelId: string) => {
    onCustomModelsChange(customModels.filter(m => m !== modelId))
    // Also deselect the removed model
    if (selectedModels.has(modelId)) {
      const next = new Set(selectedModels)
      next.delete(modelId)
      // Ensure at least one model is selected
      if (next.size === 0) {
        const firstPreset = presetModels[0]?.id
        if (firstPreset) next.add(firstPreset)
      }
      onSelectedModelsChange(next)
    }
  }, [customModels, onCustomModelsChange, selectedModels, onSelectedModelsChange, presetModels])

  const renderValidationStatus = (modelId: string) => {
    const validation = validationStates[modelId]
    if (!validation || validation.state === 'idle') return null

    if (validation.state === 'validating') {
      return <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
    }
    if (validation.state === 'success') {
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('settings:ai.model.valid')}
        </span>
      )
    }
    if (validation.state === 'error') {
      return (
        <span className="flex items-center gap-1 text-xs text-red-500" title={validation.error}>
          <XCircle className="h-3.5 w-3.5" />
          {t('settings:ai.model.invalid')}
        </span>
      )
    }
    return null
  }

  // Determine ordering: first selected model is the "default"
  const selectedArray = Array.from(selectedModels)
  const defaultModelId = selectedArray[0]

  const renderModelRow = (
    modelId: string,
    label: string,
    description: string | undefined,
    isPreset: boolean,
  ) => {
    const isSelected = selectedModels.has(modelId)
    const isDefault = modelId === defaultModelId
    const validation = validationStates[modelId]
    const isValidating = validation?.state === 'validating'

    return (
      <div
        key={modelId}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 transition-colors',
          !disabled && 'cursor-pointer hover:bg-foreground/[0.02]',
          isSelected && 'bg-foreground/[0.04]',
          disabled && 'opacity-60',
        )}
        onClick={() => !disabled && toggleModel(modelId)}
      >
        {/* Checkbox indicator */}
        <div className={cn(
          'w-4 h-4 rounded-[4px] border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          isSelected ? 'border-accent bg-accent' : 'border-foreground/20',
        )}>
          {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>

        {/* Model info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{label}</span>
            {isPreset && (
              <span className="inline-flex items-center h-4 px-1.5 text-[10px] font-medium rounded bg-accent/10 text-accent">
                {t('settings:ai.model.recommended')}
              </span>
            )}
            {isDefault && isSelected && (
              <span className="inline-flex items-center h-4 px-1.5 text-[10px] font-medium rounded bg-foreground/10 text-foreground/60">
                Default
              </span>
            )}
          </div>
          {description && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{description}</div>
          )}
        </div>

        {/* Validation status + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {canValidate && renderValidationStatus(modelId)}
          {canValidate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); validateModel(modelId) }}
              disabled={isValidating || disabled}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {isValidating ? t('settings:ai.model.validating') : t('settings:ai.model.validate')}
            </button>
          )}
          {!isPreset && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRemoveCustomModel(modelId) }}
              disabled={disabled}
              className="p-0.5 rounded hover:bg-foreground/[0.05] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title={t('settings:ai.model.remove')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="py-2">
      {/* Label */}
      {showLabel && (
        <div className="px-4 pb-2">
          <div className="text-sm font-medium">{t('settings:ai.model.label')}</div>
          <div className="text-xs text-muted-foreground">{t('settings:ai.model.description')}</div>
        </div>
      )}

      {/* Preset models */}
      {presetModels.map((model) =>
        renderModelRow(model.id, model.label, model.description, true)
      )}

      {/* Custom models */}
      {customModels.map((modelId) =>
        renderModelRow(modelId, modelId, undefined, false)
      )}

      {/* Add custom model input */}
      <div className="flex items-center gap-2 px-4 py-2 mt-1">
        <input
          type="text"
          value={newModelId}
          onChange={(e) => setNewModelId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddCustomModel()
            }
          }}
          placeholder={t('settings:ai.model.addCustomPlaceholder')}
          className="flex-1 h-8 px-3 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={disabled}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCustomModel}
          disabled={!newModelId.trim() || disabled}
          className="h-8"
        >
          {t('settings:ai.model.addCustom')}
        </Button>
      </div>

      {/* Validate All button - only when validation is available */}
      {canValidate && (
        <div className="px-4 pt-1 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidateAll}
            disabled={disabled}
            className="h-7 text-xs"
          >
            {t('settings:ai.model.validateAll')}
          </Button>
        </div>
      )}
    </div>
  )
}
