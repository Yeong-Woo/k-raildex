/** 변환 결과를 계약(zod)으로 미리 검사 — 적재 전에 형식 오류를 한꺼번에 본다 */
import { entityContracts, TimetableSetSchema } from '@k-raildex/contracts';
import type { TransformResult } from './transform';

export interface ContractIssue {
  entity_type: string;
  id: string;
  path: string;
  message: string;
}

export function checkContracts(tr: TransformResult): ContractIssue[] {
  const out: ContractIssue[] = [];
  for (const st of tr.stages) {
    for (const op of st.ops) {
      const c = entityContracts[op.entity_type];
      const r =
        op.op === 'create' ? c.create.safeParse(op.data) : op.op === 'update' ? c.update.safeParse(op.data) : null;
      if (r && !r.success) {
        const id = op.op === 'create' ? String((op.data as { id?: string }).id) : op.id;
        for (const i of r.error.issues)
          out.push({ entity_type: op.entity_type, id, path: i.path.join('.'), message: i.message });
      }
    }
  }
  for (const s of tr.timetables) {
    const r = TimetableSetSchema.safeParse(s);
    if (!r.success)
      for (const i of r.error.issues)
        out.push({ entity_type: 'timetable_set', id: s.id, path: i.path.join('.'), message: i.message });
  }
  return out;
}
