import type { PrismaClient } from '../src/generated/prisma/client.js';
import { listPublicCarouselImages } from '../src/media/carousel-operations.js';

describe('public carousel URLs', () => {
  it('replaces the stored development URL with a temporary object download URL', async () => {
    const database = {
      carouselImage: {
        findMany: async () => [{
          id: 'carousel-1',
          objectKey: 'carousel/slide.webp',
          publicUrl: 'https://bucket.r2.dev/carousel/slide.webp',
          altText: 'Festival crowd',
          eyebrow: 'Featured',
          headline: 'A night out',
          copy: 'Live music.',
          ctaLabel: 'Find tickets',
          ctaHref: '/discover',
        }],
      },
    } as unknown as PrismaClient;

    await expect(listPublicCarouselImages(database, ({ objectKey }) => Promise.resolve(`https://signed.example.test/${objectKey}`))).resolves.toEqual([{
      id: 'carousel-1',
      publicUrl: 'https://signed.example.test/carousel/slide.webp',
      altText: 'Festival crowd',
      eyebrow: 'Featured',
      headline: 'A night out',
      copy: 'Live music.',
      ctaLabel: 'Find tickets',
      ctaHref: '/discover',
    }]);
  });
});
