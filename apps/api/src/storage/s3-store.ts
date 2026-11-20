/**
 * S3 호환 문서 저장소(로컬 SeaweedFS, 운영 R2 복제). 버킷이 없으면 처음 쓸 때 만든다.
 * (같은 구현이 apps/worker/src/s3-store.ts 에 있다 — 앱마다 @aws-sdk 의존성을 따로 가져서)
 */
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DomainError, type ObjectStore, type StoredObjectInfo } from '@k-raildex/domain';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const isMissing = (e: unknown) => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
};

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  /** 버킷이 없으면 만든다(한 번만) */
  ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      } catch (e) {
        if (!isMissing(e)) throw e;
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
      }
    })().catch((e: unknown) => {
      this.bucketReady = null;
      throw e;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  private async get(key: string) {
    try {
      return await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (e) {
      if (isMissing(e)) throw new DomainError('not_found', `저장소에 객체가 없음: ${key}`);
      throw e;
    }
  }

  async getBuffer(key: string): Promise<Buffer> {
    const r = await this.get(key);
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    const r = await this.get(key);
    return r.Body as Readable;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      await this.ensureBucket();
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }
}
