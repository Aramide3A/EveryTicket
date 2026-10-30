import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicMediaUrl: string };
type ObjectStoreClient = { send(command: { input: Record<string, unknown> }): Promise<unknown> };
type SignUrl = (client: unknown, command: unknown, options: { expiresIn: number }) => Promise<string>;

const imageExtensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const maxImageBytes = 5 * 1024 * 1024;

export function createR2ObjectStore({ config, client, signUrl }: { config: R2Config; client?: ObjectStoreClient; signUrl?: SignUrl }) {
  const r2Client = client ? undefined : new S3Client({
    endpoint: config.endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const signingClient = client ?? r2Client;
  const sign = signUrl ?? ((target, command, options) => getSignedUrl(target as S3Client, command as PutObjectCommand | GetObjectCommand, options));
  return {
    async createPublicImageUploadUrl({ eventId, contentType, contentLength }: { eventId: string; contentType: string; contentLength: number }): Promise<{ objectKey: string; uploadUrl: string; publicUrl: string }> {
      const extension = imageExtensions[contentType];
      if (!extension) throw new RangeError('image type is not supported');
      if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxImageBytes) throw new RangeError('image size is invalid');
      const objectKey = `events/${eventId}/media/${randomUUID()}.${extension}`;
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
        CacheControl: 'public, max-age=31536000, immutable',
      });
      const uploadUrl = await sign(signingClient, command, { expiresIn: 300 });
      return { objectKey, uploadUrl, publicUrl: `${config.publicMediaUrl}/${objectKey}` };
    },

    async putPrivatePdf({ objectKey, pdf }: { objectKey: string; pdf: Uint8Array }): Promise<void> {
      if (!objectKey.startsWith('tickets/') || !objectKey.endsWith('.pdf')) throw new RangeError('private ticket object key is invalid');
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: pdf,
        ContentType: 'application/pdf',
        CacheControl: 'private, no-store',
      });
      if (client) await client.send(command as unknown as { input: Record<string, unknown> });
      else await r2Client!.send(command);
    },

    createPrivateDownloadUrl({ objectKey }: { objectKey: string }): Promise<string> {
      if (!objectKey.startsWith('tickets/') || !objectKey.endsWith('.pdf')) throw new RangeError('private ticket object key is invalid');
      return sign(signingClient, new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }), { expiresIn: 300 });
    },

    async verifyPublicImage({ objectKey, contentType, contentLength }: { objectKey: string; contentType: string; contentLength: number }): Promise<boolean> {
      const extension = imageExtensions[contentType];
      if (!extension || !isPublicMediaKey(objectKey) || !objectKey.endsWith(`.${extension}`) || !isValidImageSize(contentLength)) return false;
      try {
        const command = new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey });
        const result = client
          ? await client.send(command as unknown as { input: Record<string, unknown> })
          : await r2Client!.send(command);
        return hasExpectedImageMetadata(result, contentType, contentLength);
      } catch {
        return false;
      }
    },

    async deletePublicObject({ objectKey }: { objectKey: string }): Promise<void> {
      if (!isPublicMediaKey(objectKey)) throw new RangeError('public media object key is invalid');
      const command = new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey });
      if (client) await client.send(command as unknown as { input: Record<string, unknown> });
      else await r2Client!.send(command);
    },
  };
}

function isPublicMediaKey(objectKey: string): boolean {
  return /^events\/[^/]+\/media\/[^/]+\.(?:jpg|png|webp)$/.test(objectKey);
}

function isValidImageSize(contentLength: number): boolean {
  return Number.isSafeInteger(contentLength) && contentLength > 0 && contentLength <= maxImageBytes;
}

function hasExpectedImageMetadata(result: unknown, contentType: string, contentLength: number): boolean {
  if (!result || typeof result !== 'object') return false;
  const metadata = result as { ContentType?: unknown; ContentLength?: unknown };
  return metadata.ContentType === contentType && metadata.ContentLength === contentLength;
}
