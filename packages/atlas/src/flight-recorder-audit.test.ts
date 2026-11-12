import { describe, expect, it } from 'vitest';
import { canonicalEvent, normaliseEvent, parseTelemetry } from './flight-recorder.js';
import { analyseTelemetry } from './flight-recorder-extended.js';

describe('flight-recorder audit regressions', () => {
  it('does not treat a watchdog mention without action wording as an anomaly', () => {
    expect(normaliseEvent('watchdog fed')).toBe('watchdog_info');
    expect(normaliseEvent('WDT enabled')).toBe('watchdog_info');
    const session = parseTelemetry('event="watchdog fed"\nevent="watchdog enabled"', 'key-value');
    expect(session.watchdogEvents).toBe(0);
    expect(analyseTelemetry(session).anomalies).toHaveLength(0);
  });

  it('still flags real watchdog actions', () => {
    expect(normaliseEvent('watchdog timeout')).toBe('watchdog');
    expect(normaliseEvent('WDT reset')).toBe('watchdog_reset');
    const session = parseTelemetry('event="watchdog timeout"', 'key-value');
    expect(session.watchdogEvents).toBe(1);
    expect(analyseTelemetry(session).anomalies.length).toBeGreaterThan(0);
  });

  it('counts restart as a reset', () => {
    expect(normaliseEvent('device restart')).toBe('reset');
    expect(parseTelemetry('event=restart', 'key-value').resetEvents).toBe(1);
  });

  it('canonicalEvent is idempotent', () => {
    for (const text of ['watchdog fed', 'watchdog timeout', 'boot', 'panic', 'zzz']) {
      const once = canonicalEvent(text);
      expect(canonicalEvent(once)).toBe(once);
    }
    expect(canonicalEvent('watchdog_info')).toBe('watchdog_info');
  });

  it('reports threshold rules whose metric never appears instead of silently passing', () => {
    const session = parseTelemetry('temp=20\ntemp=21', 'key-value');
    const analysis = analyseTelemetry(session, {
      thresholds: [{ id: 'typo', metric: 'tmep', max: 30 }],
    });
    expect(analysis.unmatchedRuleIds).toEqual(['typo']);
    expect(analysis.limitations.join(' ')).toContain('NOT evaluated');
    const ok = analyseTelemetry(session, { thresholds: [{ id: 'ok', metric: 'temp', max: 30 }] });
    expect(ok.unmatchedRuleIds).toEqual([]);
  });

  it('does not inherit units from Object.prototype', () => {
    const session = parseTelemetry('constructor=5\ntoString=2', 'key-value');
    const analysis = analyseTelemetry(session);
    expect(analysis.metricStats['constructor']?.unit).toBeNull();
    expect(analysis.metricStats['toString']?.unit).toBeNull();
  });
});
