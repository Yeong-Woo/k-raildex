/** 설정(docs/05-admin-app.md 2절 "설정"): API 토큰 · 에이전트 예산 · 참조 테이블(읽기 전용) · 전체 검증 */
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@k-raildex/ui';
import { BudgetPanel } from '../ops/BudgetPanel';
import { OpsStatusBanner } from '../ops/OpsStatusBanner';
import { ReferencePanel } from '../ops/ReferencePanel';
import { TokensPanel } from '../ops/TokensPanel';
import { ValidationPanel } from '../ops/ValidationPanel';

const TAB_KEY = 'krdx:settings-tab';
const TABS = ['tokens', 'budget', 'reference', 'validation'] as const;

function initialTab(): string {
  try {
    const t = window.sessionStorage.getItem(TAB_KEY);
    if (t && (TABS as readonly string[]).includes(t)) return t;
  } catch {
    /* 저장소를 못 쓰면 기본 탭 */
  }
  return 'tokens';
}

export function Settings() {
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">설정</h1>
      <OpsStatusBanner />
      <Tabs
        value={tab}
        onValueChange={(t) => {
          setTab(t);
          try {
            window.sessionStorage.setItem(TAB_KEY, t);
          } catch {
            /* 무시 */
          }
        }}
      >
        <TabsList className="mb-3">
          <TabsTrigger value="tokens">API 토큰</TabsTrigger>
          <TabsTrigger value="budget">에이전트 예산</TabsTrigger>
          <TabsTrigger value="reference">참조 테이블</TabsTrigger>
          <TabsTrigger value="validation">검증</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens">
          <TokensPanel />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetPanel />
        </TabsContent>
        <TabsContent value="reference">
          <ReferencePanel />
        </TabsContent>
        <TabsContent value="validation">
          <ValidationPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
