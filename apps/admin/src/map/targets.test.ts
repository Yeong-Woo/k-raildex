import { describe, expect, it } from 'vitest';
import { pickTargets, targetOf } from './targets';

const f = (layer: string, properties: Record<string, unknown>) => ({ layer: { id: layer }, properties });

describe('targetOf', () => {
  it('역 > 계획 > 노선 순으로 판별', () => {
    expect(targetOf({ station_id: 's', line_id: 'l' })?.kind).toBe('station');
    expect(targetOf({ plan_id: 'p', line_id: 'l' })?.kind).toBe('plan');
    expect(targetOf({ line_id: 'l' })?.kind).toBe('line');
    expect(targetOf({ name_ko: 'x' })).toBeNull();
  });
});

describe('pickTargets', () => {
  const layers = ['current-station', 'current-line', 'current-line-construction'];
  it('겹친 노선은 모두(중복 제거, 레이어 순서)', () => {
    const r = pickTargets(
      [
        f('current-line-construction', { line_id: 'line-c' }),
        f('current-line', { line_id: 'line-gtx-a' }),
        f('current-line', { line_id: 'line-suseo-pyeongtaek-hsr' }),
        f('current-line', { line_id: 'line-gtx-a' }),
      ],
      layers,
    );
    expect(r.map((t) => t.id)).toEqual(['line-gtx-a', 'line-suseo-pyeongtaek-hsr', 'line-c']);
  });
  it('역이 잡히면 역 하나만', () => {
    const r = pickTargets([f('current-line', { line_id: 'a' }), f('current-station', { station_id: 'stn' })], layers);
    expect(r).toEqual([{ kind: 'station', id: 'stn', props: { station_id: 'stn' } }]);
  });
  it('목록에 없는 레이어는 무시', () => {
    expect(pickTargets([f('other', { line_id: 'a' })], layers)).toEqual([]);
  });
});
