/**
 * 위성 비교(FR-ADM-076, Q68 A): Google Maps(위성) 위에 우리 노선·역·계획 선형을 겹쳐 그린다. 관리 앱 전용.
 * 구글에서 얻은 좌표·지명은 저장하지 않는다 — 이 화면에는 쓰기 기능이 없다. 좌표 수정은 [지도 편집]에서.
 * 키(VITE_GOOGLE_MAPS_API_KEY)가 없으면 안내만 보여 준다.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { STAGE_COLORS, STATUS_COLORS } from '@k-raildex/map';
import { Card } from '@k-raildex/ui';
import { Satellite } from 'lucide-react';
import { apiOptional } from '../lib/api';
import { GOOGLE_MAPS_KEY, type FeatureCollection } from './useMap';

/* 구글 지도 JS API 의 필요한 부분만(타입 패키지 없이) */
interface GFeature {
  getProperty(k: string): unknown;
  getGeometry(): { getType(): string } | null;
}
interface GData {
  addGeoJson(fc: unknown): unknown;
  setStyle(fn: (f: GFeature) => Record<string, unknown>): void;
}
interface GMap {
  data: GData;
}
type GoogleNs = {
  maps: { Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap; Data: new (o: { map: GMap }) => GData };
};

let loader: Promise<GoogleNs> | null = null;
function loadGoogle(key: string): Promise<GoogleNs> {
  const w = window as unknown as { google?: GoogleNs; __kr_gmaps_cb?: () => void };
  if (w.google?.maps) return Promise.resolve(w.google);
  loader ??= new Promise((resolve, reject) => {
    w.__kr_gmaps_cb = () => resolve(w.google!);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__kr_gmaps_cb`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps 스크립트를 불러오지 못했습니다'));
    document.head.append(s);
  });
  return loader;
}

export function SatelliteCompare() {
  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-lg p-6 text-sm" data-testid="satellite-placeholder">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Satellite className="size-5" /> 위성 비교 — Google Maps 키가 필요합니다
          </div>
          <p className="text-fg-muted">
            구글 위성 사진 위에 우리 노선·역·계획 선형을 겹쳐 보는 관리 앱 전용 화면입니다(Q68 A). 관리 앱 빌드 환경에{' '}
            <code>VITE_GOOGLE_MAPS_API_KEY</code>(관리 앱 도메인으로 제한한 키)를 넣으면 켜집니다.
          </p>
          <ul className="mt-3 list-disc pl-5 text-fg-muted">
            <li>구글에서 얻은 좌표·지명은 저장하지 않습니다.</li>
            <li>
              좌표 수정은{' '}
              <Link to="/map" search={{ tab: 'edit' }} className="underline">
                지도 편집
              </Link>
              (VWorld/OSM 배경)에서 합니다.
            </li>
          </ul>
        </Card>
      </div>
    );
  }
  return <GoogleOverlay apiKey={GOOGLE_MAPS_KEY} />;
}

function GoogleOverlay({ apiKey }: { apiKey: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const g = await loadGoogle(apiKey);
        if (cancelled || !el.current) return;
        const map = new g.maps.Map(el.current, {
          center: { lat: 37.55, lng: 127.0 },
          zoom: 8,
          mapTypeId: 'satellite',
          tilt: 0,
          streetViewControl: true,
        });
        const [lines, stations, future] = await Promise.all([
          apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
          apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
          apiOptional<FeatureCollection>('/v1/admin/map/lines?at=future&include_undated=true'),
        ]);
        if (cancelled) return;
        // 화면 표시용으로만 겹친다(읽기 전용)
        for (const fc of [lines, future, stations]) if (fc) map.data.addGeoJson(fc);
        map.data.setStyle((f) => {
          const type = f.getGeometry()?.getType();
          if (type === 'Point')
            return {
              icon: {
                path: 0, // google.maps.SymbolPath.CIRCLE
                scale: 4,
                fillColor: STATUS_COLORS[String(f.getProperty('status'))] ?? '#ffffff',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 1,
              },
              title: String(f.getProperty('name_ko') ?? ''),
            };
          const planned = f.getProperty('plan_id') != null || f.getProperty('stage') != null;
          return {
            strokeColor:
              (f.getProperty('color') as string | null) ??
              (planned ? (STAGE_COLORS[String(f.getProperty('stage'))] ?? '#F59E0B') : '#38BDF8'),
            strokeWeight: planned ? 3 : 2.5,
            strokeOpacity: planned ? 0.8 : 0.95,
          };
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiKey]);
  return (
    <div className="absolute inset-0">
      <div ref={el} className="absolute inset-0" />
      {err ? (
        <div className="absolute top-3 left-3 rounded-md bg-danger px-3 py-2 text-xs text-white shadow">{err}</div>
      ) : null}
      <p className="absolute bottom-6 left-2 rounded bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-muted shadow">
        참고용 겹쳐 보기 — 구글 좌표·지명은 저장하지 않습니다
      </p>
    </div>
  );
}
