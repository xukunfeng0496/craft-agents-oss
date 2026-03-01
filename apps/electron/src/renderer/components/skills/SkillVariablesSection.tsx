/**
 * SkillVariablesSection
 *
 * Displays and manages skill variable configuration.
 * Shows all variables defined in skill metadata with input fields for values.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Check, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Info_Section } from '@/components/info'
import type { SkillVariable } from '@work-agent/shared/skills/types'

interface SkillVariablesSectionProps {
  workspaceId: string
  skillSlug: string
  variables: SkillVariable[]
}

export function SkillVariablesSection({
  workspaceId,
  skillSlug,
  variables,
}: SkillVariablesSectionProps) {
  const { t } = useTranslation(['common'])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Load current variable values
  useEffect(() => {
    const loadValues = async () => {
      try {
        const varNames = variables.map((v) => v.name)
        const loadedValues = await window.electronAPI.getSkillVars(
          workspaceId,
          skillSlug,
          varNames
        )
        setValues(loadedValues)
      } catch (err) {
        console.error('Failed to load skill variables:', err)
        toast.error('Failed to load variable values')
      } finally {
        setLoading(false)
      }
    }

    loadValues()
  }, [workspaceId, skillSlug, variables])

  // Handle value change
  const handleChange = useCallback((varName: string, value: string) => {
    setValues((prev) => ({ ...prev, [varName]: value }))
    setHasChanges(true)
  }, [])

  // Handle save
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.electronAPI.setSkillVars(workspaceId, skillSlug, values)
      toast.success('Variables saved successfully')
      setHasChanges(false)
    } catch (err) {
      console.error('Failed to save skill variables:', err)
      toast.error('Failed to save variables', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }, [workspaceId, skillSlug, values])

  // Count unset required variables
  const unsetRequired = variables.filter(
    (v) => v.required && !values[v.name]
  ).length

  if (loading) {
    return (
      <Info_Section title="Variables">
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Loading variables...
        </div>
      </Info_Section>
    )
  }

  return (
    <Info_Section
      title="Variables"
      badge={
        unsetRequired > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {unsetRequired} required
          </span>
        ) : undefined
      }
      actions={
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? (
            <>Saving...</>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </>
          )}
        </Button>
      }
    >
      <div className="space-y-4 px-4 py-3">
        {variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This skill has no configurable variables.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Configure the variables used by this skill. Required variables
              must be set before the skill can be used.
            </p>

            <div className="space-y-4">
              {variables.map((variable) => {
                const value = values[variable.name] || ''
                const isSet = !!value
                const showDefault =
                  !variable.required && variable.default && !isSet

                return (
                  <div key={variable.name} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`var-${variable.name}`} className="text-sm font-medium">
                        {variable.name}
                        {variable.required && (
                          <span className="text-destructive ml-1">*</span>
                        )}
                      </Label>
                      {isSet && (
                        <Check className="h-3.5 w-3.5 text-success" />
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {variable.description}
                      {showDefault && (
                        <span className="ml-1">
                          (default: {variable.default})
                        </span>
                      )}
                    </p>

                    <Input
                      id={`var-${variable.name}`}
                      type="text"
                      value={value}
                      onChange={(e) => handleChange(variable.name, e.target.value)}
                      placeholder={variable.example || `Enter ${variable.name}`}
                      className="font-mono text-sm"
                    />
                  </div>
                )
              })}
            </div>

            {unsetRequired > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-xs text-destructive">
                  {unsetRequired} required {unsetRequired === 1 ? 'variable' : 'variables'} must be configured before this skill can be used.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Info_Section>
  )
}
