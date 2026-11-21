/** 역 목록 표(역 목록·시·도/권역 페이지 공용). 서버 컴포넌트 */
import type { LineRef, RegionRef, StationItem } from '@/lib/data';
import { STOP_CLASS_LABEL, stopClassesOf } from '@/lib/format';
import { paths } from '@/lib/urls';
import { LineChip, ReviewBadge, StatusBadge, FuzzyDateText } from './badges';

export function StationTable({
  items,
  lineIndex,
  regionByCode,
  showRegion = true,
}: {
  items: StationItem[];
  lineIndex: Map<string, LineRef>;
  regionByCode: Map<string, RegionRef>;
  showRegion?: boolean;
}) {
  if (items.length === 0) return <p className="empty surface">조건에 맞는 역이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data cardify">
        <thead>
          <tr>
            <th scope="col">역</th>
            <th scope="col">역번호</th>
            <th scope="col">노선</th>
            {showRegion ? <th scope="col">시·도</th> : null}
            <th scope="col">상태</th>
            <th scope="col">구분(정차 열차)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const classes = stopClassesOf(s.service_kinds, s.line_classes);
            return (
              <tr key={s.id}>
                <td>
                  <a href={paths.station(s.id)}>{s.name_ko}</a> <ReviewBadge status={s.review_status} />
                  {s.name_en ? <span className="name-sub">{s.name_en}</span> : null}
                </td>
                <td data-label="역번호" className="num" style={{ fontSize: 'var(--kr-text-xs)' }}>
                  {s.station_codes.join(' · ') || '—'}
                </td>
                <td data-label="노선">
                  <span className="chips">
                    {s.line_ids.map((id) => {
                      const l = lineIndex.get(id);
                      return l ? <LineChip key={id} line={l} /> : null;
                    })}
                  </span>
                </td>
                {showRegion ? (
                  <td data-label="시·도" style={{ fontSize: 'var(--kr-text-xs)' }}>
                    {s.region_code ? (regionByCode.get(s.region_code)?.short_ko ?? s.region_code) : '지역 미상'}
                  </td>
                ) : null}
                <td data-label="상태">
                  <StatusBadge status={s.status} />
                  {s.status === 'closed' && s.closed ? (
                    <span className="name-sub">
                      폐지 <FuzzyDateText value={s.closed} />
                    </span>
                  ) : null}
                </td>
                <td data-label="구분" style={{ fontSize: 'var(--kr-text-xs)' }}>
                  {classes.map((c) => STOP_CLASS_LABEL[c].replace(/ 정차역$|역$/, '')).join(' · ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
