import { Body, Controller, Delete, Get, Header, Param, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { createR2ObjectStore } from '../worker/r2-object-store.js';
import { readR2Config } from '../worker/worker-config.js';
import { completeCarouselUpload, createCarouselUploadIntent, listAdminCarouselImages, listPublicCarouselImages, removeCarouselImage } from './carousel-operations.js';

const withDatabase = createDatabaseOperation('carousel is not configured');
const store = () => createR2ObjectStore({ config: readR2Config(process.env) });
const publicItem = { type: 'object' as const, required: ['id', 'publicUrl', 'altText'], properties: { id: { type: 'string' as const }, publicUrl: { type: 'string' as const }, altText: { type: 'string' as const } } };

@ApiTags('Carousel')
@Controller('carousel/images')
export class CarouselController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List verified carousel images in upload order; no session required' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: publicItem } } } })
  async list() { return { items: await withDatabase(listPublicCarouselImages) }; }
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
  @ApiBody({ schema: { type: 'object', required: ['altText', 'contentType', 'contentLength'], properties: { altText: { type: 'string', minLength: 1, maxLength: 300 }, contentType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] }, contentLength: { type: 'integer', minimum: 1, maximum: 5242880 } } } })
  @ApiCreatedResponse({ schema: { type: 'object', properties: { imageId: { type: 'string' }, uploadUrl: { type: 'string' }, publicUrl: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid image type, size or alt text' })
  async intent(@Req() request: Request, @Body() body: Record<string, unknown> | undefined) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return withDatabase((database) => createCarouselUploadIntent({ database, adminProfileId: profile.id, altText: body?.altText as string, contentType: body?.contentType as string, contentLength: body?.contentLength as number, now: new Date(), createUpload: (input) => store().createCarouselImageUploadUrl(input) }));
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
