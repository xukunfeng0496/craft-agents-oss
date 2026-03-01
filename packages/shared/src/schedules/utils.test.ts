import { describe, test, expect } from 'bun:test'
import { cronToSchedule, scheduleToCron } from './utils.ts'
import type { ScheduleDay } from './types.ts'

describe('cronToSchedule', () => {
  test('parses simple daily cron', () => {
    const result = cronToSchedule('0 9 * * *')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: undefined,
    })
  })

  test('parses cron with specific days', () => {
    const result = cronToSchedule('0 9 * * 1,3,5')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'wed', 'fri'],
    })
  })

  test('parses cron with minutes', () => {
    const result = cronToSchedule('30 15 * * *')
    expect(result).toEqual({
      times: [{ hour: 15, minute: 30 }],
      days: undefined,
    })
  })

  test('parses weekdays', () => {
    const result = cronToSchedule('0 9 * * 1,2,3,4,5')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })
  })

  test('parses weekends', () => {
    const result = cronToSchedule('0 10 * * 0,6')
    expect(result).toEqual({
      times: [{ hour: 10, minute: 0 }],
      days: ['sun', 'sat'],
    })
  })

  test('returns null for complex day-of-month', () => {
    const result = cronToSchedule('0 9 15 * *')
    expect(result).toBeNull()
  })

  test('returns null for complex month', () => {
    const result = cronToSchedule('0 9 * 1,6 *')
    expect(result).toBeNull()
  })

  test('returns null for invalid format', () => {
    expect(cronToSchedule('invalid')).toBeNull()
    expect(cronToSchedule('0 9 *')).toBeNull()
    expect(cronToSchedule('')).toBeNull()
  })

  test('returns null for invalid hour/minute', () => {
    expect(cronToSchedule('60 9 * * *')).toBeNull()
    expect(cronToSchedule('0 25 * * *')).toBeNull()
    expect(cronToSchedule('-1 9 * * *')).toBeNull()
  })

  test('returns null for invalid day-of-week', () => {
    expect(cronToSchedule('0 9 * * 7')).toBeNull()
    expect(cronToSchedule('0 9 * * -1')).toBeNull()
    expect(cronToSchedule('0 9 * * abc')).toBeNull()
  })
})

describe('scheduleToCron and cronToSchedule roundtrip', () => {
  test('roundtrip: daily schedule', () => {
    const times = [{ hour: 9, minute: 0 }]
    const crons = scheduleToCron(times)
    const result = cronToSchedule(crons[0]!)
    expect(result).toEqual({ times, days: undefined })
  })

  test('roundtrip: weekday schedule', () => {
    const times = [{ hour: 9, minute: 30 }]
    const days: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri']
    const crons = scheduleToCron(times, days)
    const result = cronToSchedule(crons[0]!)
    expect(result).toEqual({ times, days })
  })

  test('roundtrip: weekend schedule', () => {
    const times = [{ hour: 10, minute: 0 }]
    const days: ScheduleDay[] = ['sat', 'sun']
    const crons = scheduleToCron(times, days)
    const result = cronToSchedule(crons[0]!)
    expect(result?.times).toEqual(times)
    expect(result?.days).toContain('sat')
    expect(result?.days).toContain('sun')
  })
})
