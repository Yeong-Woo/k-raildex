/**
 * 오브젝트 저장소 추상화(원문 문서). 운영·개발은 S3 호환(SeaweedFS·R2) 구현을 api·worker 가 각자 만든다
 * (@aws-sdk/client-s3 는 앱 의존성). 시험은 메모리 구현을 쓴다.
 */
import { Readable } from 'node:stream';
import { DomainError } from './errors';

export interface StoredObjectInfo {
  size: number;
  contentType: string | null;
}

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** 없으면 DomainError not_found */
  getBuffer(key: string): Promise<Buffer>;
  /** 없으면 DomainError not_found */
  getStream(key: string): Promise<Readable>;
  /** 없으면 null */
  head(key: string): Promise<StoredObjectInfo | null>;
}

/** 시험·로컬 도구용 메모리 저장소 */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new DomainError('not_found', `저장소에 객체가 없음: ${key}`);
    return o.body;
  }

  async getStream(key: string): Promise<Readable> {
    return Readable.from([await this.getBuffer(key)]);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, contentType: o.contentType } : null;
  }
}

/** 설정이 없을 때: 모든 호출이 실패(API 는 503 으로 옮긴다) */
export class UnconfiguredObjectStore implements ObjectStore {
  private fail(): never {
    throw new StorageUnavailableError('문서 저장소(S3) 설정이 없음 — S3_ENDPOINT·S3_ACCESS_KEY·S3_SECRET_KEY');
  }
  async put(): Promise<void> {
    this.fail();
  }
  async getBuffer(): Promise<Buffer> {
    this.fail();
  }
  async getStream(): Promise<Readable> {
    this.fail();
  }
  async head(): Promise<StoredObjectInfo | null> {
    this.fail();
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}
