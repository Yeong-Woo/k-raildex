-- 0001 확장·공용 함수 (docs/03-data-model.md 2-3절, 7절)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 퍼지 날짜: contracts/src/fuzzy-date.ts 와 같은 규칙. 생성 열에 쓰므로 IMMUTABLE(make_date 만 사용).
CREATE OR REPLACE FUNCTION fuzzy_valid(v text, p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE y int; m int; d int;
BEGIN
  IF p IS NULL THEN RETURN v IS NULL; END IF;
  IF p = 'unknown' THEN RETURN v IS NULL; END IF;
  IF v IS NULL THEN RETURN false; END IF;
  IF p = 'day' THEN
    IF v !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    y := substr(v,1,4)::int; m := substr(v,6,2)::int; d := substr(v,9,2)::int;
    IF m < 1 OR m > 12 OR d < 1 THEN RETURN false; END IF;
    RETURN d <= extract(day FROM (make_date(y, m, 1) + interval '1 month - 1 day'))::int AND y BETWEEN 1800 AND 2200;
  ELSIF p = 'month' THEN
    IF v !~ '^\d{4}-\d{2}$' THEN RETURN false; END IF;
    m := substr(v,6,2)::int;
    RETURN m BETWEEN 1 AND 12 AND substr(v,1,4)::int BETWEEN 1800 AND 2200;
  ELSIF p = 'half' THEN
    RETURN v ~ '^\d{4}-H[12]$' AND substr(v,1,4)::int BETWEEN 1800 AND 2200;
  ELSIF p = 'year' THEN
    RETURN v ~ '^\d{4}$' AND v::int BETWEEN 1800 AND 2200;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION fuzzy_from(v text, p text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR p IS NULL OR p = 'unknown' OR NOT fuzzy_valid(v, p) THEN NULL
    WHEN p = 'day'   THEN make_date(substr(v,1,4)::int, substr(v,6,2)::int, substr(v,9,2)::int)
    WHEN p = 'month' THEN make_date(substr(v,1,4)::int, substr(v,6,2)::int, 1)
    WHEN p = 'half'  THEN make_date(substr(v,1,4)::int, CASE WHEN right(v,1) = '1' THEN 1 ELSE 7 END, 1)
    WHEN p = 'year'  THEN make_date(v::int, 1, 1)
  END
$$;

CREATE OR REPLACE FUNCTION fuzzy_to(v text, p text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR p IS NULL OR p = 'unknown' OR NOT fuzzy_valid(v, p) THEN NULL
    WHEN p = 'day'   THEN make_date(substr(v,1,4)::int, substr(v,6,2)::int, substr(v,9,2)::int)
    WHEN p = 'month' THEN (make_date(substr(v,1,4)::int, substr(v,6,2)::int, 1) + interval '1 month - 1 day')::date
    WHEN p = 'half'  THEN CASE WHEN right(v,1) = '1' THEN make_date(substr(v,1,4)::int, 6, 30) ELSE make_date(substr(v,1,4)::int, 12, 31) END
    WHEN p = 'year'  THEN make_date(v::int, 12, 31)
  END
$$;

-- 한글 초성(검색). 완성형 음절만 변환, 나머지 문자는 그대로.
CREATE OR REPLACE FUNCTION hangul_chosung(s text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT string_agg(
    CASE WHEN ascii(c) BETWEEN 44032 AND 55203
      THEN substr('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', (ascii(c) - 44032) / 588 + 1, 1)
      ELSE c END, '' ORDER BY i)
  FROM unnest(regexp_split_to_array(s, '')) WITH ORDINALITY AS t(c, i)
$$;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
