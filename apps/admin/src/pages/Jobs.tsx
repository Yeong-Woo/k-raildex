/** 작업(job) 목록·요청 — WP 5.10 에서 채운다 */
import { Empty } from '@k-raildex/ui';

export function Jobs() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">작업</h1>
      <Empty>준비 중</Empty>
    </div>
  );
}
