import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { createR2ObjectStore } from '../worker/r2-object-store.js';
import { readR2Config } from '../worker/worker-config.js';
import { completeCarouselUpload, createCarouselUploadIntent, listAdminCarouselImages, listPublicCarouselImages, removeCarouselImage, updateCarouselSlide } from './carousel-operations.js';

const withDatabase = createDatabaseOperation('carousel is not configured');
const store = () => createR2ObjectStore({ config: readR2Config(process.env) });
const publicItem = { type: 'object' as const, required: ['id', 'publicUrl', 'altText', 'eyebrow', 'headline', 'copy', 'ctaLabel', 'ctaHref'], properties: { id: { type: 'string' as const }, publicUrl: { type: 'string' as const }, altText: { type: 'string' as const }, eyebrow: { type: 'string' as const, nullable: true }, headline: { type: 'string' as const, nullable: true }, copy: { type: 'string' as const, nullable: true }, ctaLabel: { type: 'string' as const, nullable: true }, ctaHref: { type: 'string' as const, nullable: true } } };
const slideBody = { type: 'object' as const, required: ['eyebrow', 'headline', 'copy', 'ctaLabel', 'ctaHref'], properties: { eyebrow: { type: 'string' as const, minLength: 1, maxLength: 80 }, headline: { type: 'string' as const, minLength: 1, maxLength: 140 }, copy: { type: 'string' as const, minLength: 1, maxLength: 360 }, ctaLabel: { type: 'string' as const, minLength: 1, maxLength: 48 }, ctaHref: { type: 'string' as const, minLength: 1, maxLength: 2048 } } };

@ApiTags('Carousel')
@Controller('carousel/images')
export class CarouselController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List verified carousel images in upload order; no session required' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: publicItem } } } })
  async list() {
    const config = readR2Config(process.env);
    const imageStore = createR2ObjectStore({ config });
    const createDownloadUrl = new URL(config.publicMediaUrl).hostname.endsWith('.r2.dev')
      ? (image: { objectKey: string }) => imageStore.createCarouselImageDownloadUrl(image)
      : undefined;
    return { items: await withDatabase((database) => listPublicCarouselImages(database, createDownloadUrl)) };
  }
}

@ApiTags('Administration')
@ApiBearerAuth('session')
@ApiUnauthorizedResponse({ description: 'Active administrator access required' })
@Controller('admin/carousel/images')
export class AdminCarouselController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List ready carousel images with upload metadata, oldest first' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: { ...publicItem, properties: { ...publicItem.properties, contentType: { type: 'string' }, contentLength: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' } } } } } } })
  async list(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return { items: await withDatabase((database) => listAdminCarouselImages({ database, adminProfileId: profile.id })) };
  }

  @Post('upload-intent')
  @ApiOperation({ summary: 'Create a five-minute signed PUT URL; complete within fifteen minutes' })
  @ApiBody({ schema: { type: 'object', required: ['altText', 'contentType', 'contentLength', 'eyebrow', 'headline', 'copy', 'ctaLabel', 'ctaHref'], properties: { altText: { type: 'string', minLength: 1, maxLength: 300 }, contentType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] }, contentLength: { type: 'integer', minimum: 1, maximum: 5242880 }, ...slideBody.properties } } })
  @ApiCreatedResponse({ schema: { type: 'object', properties: { imageId: { type: 'string' }, uploadUrl: { type: 'string' }, publicUrl: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid image type, size or alt text' })
  async intent(@Req() request: Request, @Body() body: Record<string, unknown> | undefined) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return withDatabase((database) => createCarouselUploadIntent({ database, adminProfileId: profile.id, altText: body?.altText as string, contentType: body?.contentType as string, contentLength: body?.contentLength as number, eyebrow: body?.eyebrow as string, headline: body?.headline as string, copy: body?.copy as string, ctaLabel: body?.ctaLabel as string, ctaHref: body?.ctaHref as string, now: new Date(), createUpload: (input) => store().createCarouselImageUploadUrl(input) }));
  }

  @Patch(':imageId')
  @ApiOperation({ summary: 'Update the visible content for a published carousel slide' })
  @ApiBody({ schema: slideBody })
  @ApiOkResponse({ schema: { type: 'object', properties: { updated: { type: 'boolean' } } } })
  @ApiNotFoundResponse({ description: 'Carousel image was not found or is not published' })
  async update(@Req() request: Request, @Param('imageId') imageId: string, @Body() body: Record<string, unknown> | undefined) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await withDatabase((database) => updateCarouselSlide({ database, adminProfileId: profile.id, imageId, eyebrow: body?.eyebrow as string, headline: body?.headline as string, copy: body?.copy as string, ctaLabel: body?.ctaLabel as string, ctaHref: body?.ctaHref as string }));
    return { updated: true };
  }

  @Post(':imageId/complete')
  @ApiOperation({ summary: 'Verify the uploaded object and publish; safe to repeat' })
  @ApiCreatedResponse({ schema: { type: 'object', properties: { completed: { type: 'boolean' } } } })
  @ApiNotFoundResponse({ description: 'Image unavailable' })
  @ApiConflictResponse({ description: 'Expired, missing or mismatched upload' })
  async complete(@Req() request: Request, @Param('imageId') imageId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await withDatabase((database) => completeCarouselUpload({ database, adminProfileId: profile.id, imageId, now: new Date(), verifyUploadedObject: (input) => store().verifyCarouselImage(input) }));
    return { completed: true };
  }

  @Delete(':imageId')
  @ApiOperation({ summary: 'Unpublish immediately and delete the object; failed deletions are retried by the worker' })
  @ApiOkResponse({ schema: { type: 'object', properties: { removed: { type: 'boolean' } } } })
  @ApiNotFoundResponse({ description: 'Image unavailable' })
  async remove(@Req() request: Request, @Param('imageId') imageId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await withDatabase((database) => removeCarouselImage({ database, adminProfileId: profile.id, imageId, deleteObject: (objectKey) => store().deleteCarouselObject({ objectKey }) }));
    return { removed: true };
  }
}
