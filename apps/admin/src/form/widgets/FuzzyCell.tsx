/** 한 칸짜리 퍼지 날짜 입력(표용) — 글자 모양으로 정밀도를 정한다(lib/fuzzy-text) */
import { useEffect, useState } from 'react';
import { formatFuzzy, type FuzzyDate } from '@k-raildex/contracts';
import { Input } from '@k-raildex/ui';
import { fuzzyText, parseFuzzyText } from '../../lib/fuzzy-text';

export function FuzzyCell({
  value,
  onChange,
  label,
  className,
}: {
  value: unknown;
  onChange: (v: FuzzyDate | null) => void;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(fuzzyText(value as FuzzyDate | null));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(fuzzyText(value as FuzzyDate | null));
    setBad(false);
  }, [value]);
  return (
    <Input
      className={className ?? 'h-8 px-1.5 text-xs'}
      aria-label={label}
      aria-invalid={bad}
      placeholder="YYYY[-MM[-DD]]"
      title={`${value ? formatFuzzy(value as FuzzyDate) + ' — ' : ''}YYYY-MM-DD / YYYY-MM / YYYY-H1 / YYYY / ?(미상)`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const f = parseFuzzyText(text);
        if (f === undefined) setBad(true);
        else {
          setBad(false);
          onChange(f);
        }
      }}
    />
  );
}
