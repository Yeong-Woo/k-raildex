import { describe, expect, it } from 'vitest';
import { entityContracts, entityUiMeta, codes, type EntityType } from '../src';

describe('UI 메타데이터', () => {
  it('모든 계약 필드에 메타가 있고, 메타에만 있는 필드는 없다(FR-ADM-021)', () => {
    for (const [type, c] of Object.entries(entityContracts)) {
      const keys = Object.keys((c.create as unknown as { shape: object }).shape).sort();
      const meta = entityUiMeta[type as EntityType];
      expect(Object.keys(meta.fields).sort(), type).toEqual(keys);
      const groupKeys = new Set(meta.groups.map((g) => g.key));
      for (const [k, fm] of Object.entries(meta.fields)) {
        expect(groupKeys.has(fm.group), `${type}.${k} group ${fm.group}`).toBe(true);
        if (fm.widget.kind === 'code') expect(codes[fm.widget.domain], `${type}.${k}`).toBeDefined();
      }
      expect(keys).toContain(meta.titleField);
    }
  });
});
