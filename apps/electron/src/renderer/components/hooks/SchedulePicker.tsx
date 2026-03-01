import { useState } from 'react'
import type { ScheduleTime, ScheduleDay } from '@work-agent/shared/schedules'

interface SchedulePickerProps {
  times: ScheduleTime[]
  days?: ScheduleDay[]
  onChange: (times: ScheduleTime[], days?: ScheduleDay[]) => void
}

export function SchedulePicker({ times, days, onChange }: SchedulePickerProps) {
  // Implementation will be added in next step
  return <div>Schedule Picker</div>
}
