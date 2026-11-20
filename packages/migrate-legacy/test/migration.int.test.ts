/**
 * 통합 시험: 기존 저장소(LEGACY_ROOT)가 있을 때만 새 DB 에 전량 이관하고 개체 수·Hard 위반 0 을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { checkContracts } from '../src/check';
import { legacyExists, loadLegacy } from '../src/read/legacy';
import { runLoad } from '../src/load';
import { transformAll } from '../src/transform';
import { runVerify } from '../src/verify';

describe.skipIf(!legacyExists())('기존 저장소 전량 이관', () => {
  let fx: FreshDb;
  beforeAll(async () => {
    fx = await freshDb();
  });
  afterAll(async () => {
    await fx?.close();
  });

  it('적재 → 개체 수 일치·Hard 위반 0', { timeout: 600_000 }, async () => {
    const legacy = loadLegacy();
    const tr = transformAll(legacy);
    expect(checkContracts(tr)).toEqual([]);
    await runLoad(fx.client, legacy, tr);
    const v = await runVerify(fx.client, legacy, tr);
    expect(v.hardViolations).toEqual([]);
    for (const c of v.counts)
      if (c.legacy !== null && !c.entity.startsWith('timetable_'))
        expect(c, c.entity).toMatchObject({ migrated: c.legacy });
    expect(v.events.legacyIdsMissing).toEqual([]);
    // 시간표: TAGO 는 기존과 같고, 운행정보 보강 세트(수집기 kric-train-ops)는 설명된 차이만
    const tt = v.timetables.summaryDiffs;
    expect(tt.missing).toEqual([]);
    expect(tt.extra).toEqual([]);
    expect(Object.values(tt.fields).filter((f) => !f.intended)).toEqual([]);
    const explained = (o?: Record<string, string[]>) => Object.values(o ?? {}).reduce((a, l) => a + l.length, 0);
    expect(v.timetables.sets).toBe(tt.legacyCount - explained(tt.explainedMissing) + explained(tt.explainedExtra));
  });
});
