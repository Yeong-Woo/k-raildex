/** 공용: 전역 준비가 넘긴 주소를 baseURL 로 */
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    const url = process.env.E2E_BASE_URL;
    if (!url) throw new Error('E2E_BASE_URL 없음 — globalSetup 이 돌지 않았습니다');
    await use(url);
  },
});
export { expect };

/** RefInput 에서 검색해 첫 후보 고르기 */
export async function pickRef(page: Page, scope: ReturnType<Page['locator']>, query: string, option: string | RegExp) {
  const input = scope.getByPlaceholder('검색해서 고르기');
  await input.fill(query);
  await scope.getByRole('button', { name: option }).first().click();
}

/** sonner 토스트 */
export const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
