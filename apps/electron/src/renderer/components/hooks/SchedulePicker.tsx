/**
 * SchedulePicker - User-friendly time and day picker for scheduled prompts
 *
 * Features:
 * - Hour/minute selection with formatted display
 * - Multiple time support
 * - Day presets (everyday, weekdays, weekends, custom)
 * - Clean UI with shadcn/ui components
 */

import { useState, useEffect } from 'react'
import { Plus, X, Clock } from 'lucide-react'
import type { ScheduleTime, ScheduleDay } from '@work-agent/shared/schedules'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const ALL_DAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const WEEKDAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri']
const WEEKENDS: ScheduleDay[] = ['sat', 'sun']

const DAY_LABELS: Record<ScheduleDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

type DayPreset = 'everyday' | 'weekdays' | 'weekends' | 'custom'

interface SchedulePickerProps {
  times: ScheduleTime[]
  days?: ScheduleDay[]
  onChange: (times: ScheduleTime[], days?: ScheduleDay[]) => void
}

/**
 * Format time to readable string (e.g., "9:00 AM", "3:30 PM")
 */
function formatTime(time: ScheduleTime): string {
  const hour12 = time.hour % 12 || 12
  const ampm = time.hour < 12 ? 'AM' : 'PM'
  const minute = time.minute.toString().padStart(2, '0')
  return `${hour12}:${minute} ${ampm}`
}

/**
 * Convert ScheduleTime to HH:MM string for input
 */
function timeToString(time: ScheduleTime): string {
  return `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`
}

/**
 * Parse HH:MM string to ScheduleTime
 */
function stringToTime(str: string): ScheduleTime {
  const [hourStr, minStr] = str.split(':')
  return {
    hour: parseInt(hourStr, 10),
    minute: parseInt(minStr, 10),
  }
}

/**
 * Determine current day preset based on selected days
 */
function getDayPreset(days?: ScheduleDay[]): DayPreset {
  if (!days || days.length === 0) return 'everyday'
  if (days.length === 7) return 'everyday'
  if (days.length === 5 && WEEKDAYS.every(d => days.includes(d))) return 'weekdays'
  if (days.length === 2 && WEEKENDS.every(d => days.includes(d))) return 'weekends'
  return 'custom'
}

export function SchedulePicker({ times, days, onChange }: SchedulePickerProps) {
  // Local state for times
  const [localTimes, setLocalTimes] = useState<ScheduleTime[]>(times)

  // Local state for days
  const [selectedDays, setSelectedDays] = useState<ScheduleDay[]>(days ?? [])
  const [dayPreset, setDayPreset] = useState<DayPreset>(getDayPreset(days))

  // Sync with props
  useEffect(() => {
    setLocalTimes(times)
  }, [times])

  useEffect(() => {
    setSelectedDays(days ?? [])
    setDayPreset(getDayPreset(days))
  }, [days])

  // Handle time change
  const handleTimeChange = (index: number, newTime: string) => {
    const updated = [...localTimes]
    updated[index] = stringToTime(newTime)
    setLocalTimes(updated)
    onChange(updated, selectedDays.length > 0 && selectedDays.length < 7 ? selectedDays : undefined)
  }

  // Add new time
  const handleAddTime = () => {
    const newTime: ScheduleTime = { hour: 9, minute: 0 }
    const updated = [...localTimes, newTime]
    setLocalTimes(updated)
    onChange(updated, selectedDays.length > 0 && selectedDays.length < 7 ? selectedDays : undefined)
  }

  // Remove time
  const handleRemoveTime = (index: number) => {
    if (localTimes.length <= 1) return // Keep at least one time
    const updated = localTimes.filter((_, i) => i !== index)
    setLocalTimes(updated)
    onChange(updated, selectedDays.length > 0 && selectedDays.length < 7 ? selectedDays : undefined)
  }

  // Handle day preset change
  const handlePresetChange = (preset: DayPreset) => {
    setDayPreset(preset)
    let newDays: ScheduleDay[] = []

    switch (preset) {
      case 'everyday':
        newDays = []
        break
      case 'weekdays':
        newDays = [...WEEKDAYS]
        break
      case 'weekends':
        newDays = [...WEEKENDS]
        break
      case 'custom':
        newDays = selectedDays.length > 0 ? selectedDays : ['mon']
        break
    }

    setSelectedDays(newDays)
    onChange(localTimes, newDays.length > 0 && newDays.length < 7 ? newDays : undefined)
  }

  // Toggle individual day (custom mode)
  const handleToggleDay = (day: ScheduleDay) => {
    const newDays = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day]

    setSelectedDays(newDays)
    setDayPreset('custom')
    onChange(localTimes, newDays.length > 0 && newDays.length < 7 ? newDays : undefined)
  }

  return (
    <div className="space-y-6">
      {/* Time Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Times</Label>
        <div className="space-y-2">
          {localTimes.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                type="time"
                value={timeToString(time)}
                onChange={e => handleTimeChange(index, e.target.value)}
                className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="text-sm text-muted-foreground min-w-[80px]">
                {formatTime(time)}
              </span>
              {localTimes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveTime(index)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddTime}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Time
        </Button>
      </div>

      {/* Day Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Days</Label>

        {/* Day Presets */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={dayPreset === 'everyday' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetChange('everyday')}
            className="flex-1"
          >
            Every Day
          </Button>
          <Button
            type="button"
            variant={dayPreset === 'weekdays' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetChange('weekdays')}
            className="flex-1"
          >
            Weekdays
          </Button>
          <Button
            type="button"
            variant={dayPreset === 'weekends' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetChange('weekends')}
            className="flex-1"
          >
            Weekends
          </Button>
          <Button
            type="button"
            variant={dayPreset === 'custom' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetChange('custom')}
            className="flex-1"
          >
            Custom
          </Button>
        </div>

        {/* Custom Day Selection */}
        {dayPreset === 'custom' && (
          <div className="flex gap-1 pt-2">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => handleToggleDay(day)}
                className={cn(
                  'flex-1 px-2 py-2 text-xs rounded-md transition-colors font-medium',
                  selectedDays.includes(day)
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/5 hover:bg-foreground/10'
                )}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {dayPreset === 'everyday' && 'Schedule will run every day'}
          {dayPreset === 'weekdays' && 'Schedule will run Monday through Friday'}
          {dayPreset === 'weekends' && 'Schedule will run Saturday and Sunday'}
          {dayPreset === 'custom' && selectedDays.length === 0 && 'Select at least one day'}
          {dayPreset === 'custom' && selectedDays.length > 0 &&
            `Schedule will run on ${selectedDays.map(d => DAY_LABELS[d]).join(', ')}`}
        </p>
      </div>
    </div>
  )
}
