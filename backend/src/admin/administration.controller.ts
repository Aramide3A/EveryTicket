import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { readPagination } from '../common/http/pagination.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { createPaystackGateway } from '../payments/paystack-gateway.js';
import { pageAuditLogs } from '../audit/audit-log.js';
import { createEventCategory, listEventCategoriesForAdmin, updateEventCategory } from './category-administration.js';
import { setProfileAdministrator } from './admin-role-management.js';
import { approvePayoutRequest, approveRefundRequest, blockProfile, executeApprovedRefund, getActivePlatformFeeRule, getAdministrationSummary, markPayoutPaid, markRefundProcessed, pageAdministrationEvents, pageAdministrationOrders, pageAdministrationPayoutRequests, pageAdministrationProfiles, pageAdministrationRefundRequests, reconcileExecutedRefund, rejectPayoutRequest, rejectRefundRequest, replacePlatformFeeRule, restoreEvent, setEventFeatured, suspendEvent, unblockProfile } from './administration.js';

const runAdministrationDatabaseOperation = createDatabaseOperation('administration is not configured');

@ApiTags('Administration')
@ApiBearerAuth('session')
@Controller('admin')
export class AdministrationController {
  private readonly withDatabase = runAdministrationDatabaseOperation;
  @Get('summary')
  async summary(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => getAdministrationSummary({ database, adminProfileId: profile.id }));
  }

  @Get('events')
  async events(@Req() request: Request, @Query('state') state?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    if (state && !['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED'].includes(state)) throw new BadRequestException('state is invalid');
    return this.withDatabase((database) => pageAdministrationEvents({ database, adminProfileId: profile.id, state: state as 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED' | undefined, ...readPagination(page, pageSize) }));
  }

  @Post('events/:eventId/suspend')
  async suspend(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => suspendEvent({ database, adminProfileId: profile.id, eventId, reason: readString(body, 'reason'), now: new Date() }));
    return { suspended: true };
  }

  @Post('events/:eventId/restore')
  async restore(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => restoreEvent({ database, adminProfileId: profile.id, eventId }));
    return { restored: true };
  }

  @Patch('events/:eventId/featured')
  async featured(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => setEventFeatured({ database, adminProfileId: profile.id, eventId, featured: readBoolean(body, 'featured') }));
    return { updated: true };
  }

  @Get('users')
  async users(@Req() request: Request, @Query('q') query?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => pageAdministrationProfiles({ database, adminProfileId: profile.id, query, ...readPagination(page, pageSize) }));
  }

  @Get('audit-logs')
  async auditLogs(@Req() request: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => pageAuditLogs({ database, profileId: profile.id, role: 'ADMIN', ...readPagination(page, pageSize) }));
  }

  @Get('categories')
  async categories(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => listEventCategoriesForAdmin({ database, adminProfileId: profile.id }));
  }

  @Post('categories')
  async createCategory(@Req() request: Request, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => createEventCategory({ database, adminProfileId: profile.id, name: readString(body, 'name'), slug: readString(body, 'slug') }));
  }

  @Patch('categories/:categoryId')
  async updateCategory(@Req() request: Request, @Param('categoryId') categoryId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    const record = asRecord(body);
    const name = optionalString(record.name, 'name');
    const slug = optionalString(record.slug, 'slug');
    if (name === undefined && slug === undefined) throw new BadRequestException('category changes are required');
    return this.withDatabase((database) => updateEventCategory({ database, adminProfileId: profile.id, categoryId, name, slug }));
  }

  @Post('users/:profileId/block')
  async block(@Req() request: Request, @Param('profileId') profileId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => blockProfile({ database, adminProfileId: profile.id, profileId, reason: readString(body, 'reason'), now: new Date() }));
    return { blocked: true };
  }

  @Post('users/:profileId/unblock')
  async unblock(@Req() request: Request, @Param('profileId') profileId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => unblockProfile({ database, adminProfileId: profile.id, profileId, now: new Date() }));
    return { unblocked: true };
  }

  @Patch('users/:profileId/administrator')
  async setAdministrator(@Req() request: Request, @Param('profileId') profileId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => setProfileAdministrator({
      database,
      adminProfileId: profile.id,
      profileId,
      enabled: readBoolean(body, 'enabled'),
    }));
  }

  @Get('orders')
  async orders(@Req() request: Request, @Query('q') query?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => pageAdministrationOrders({ database, adminProfileId: profile.id, query, status: readOptionalEnum(status, ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID_NEEDS_RESOLUTION'] as const), ...readPagination(page, pageSize) }));
  }

  @Get('refund-requests')
  async refunds(@Req() request: Request, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => pageAdministrationRefundRequests({ database, adminProfileId: profile.id, status: readOptionalEnum(status, ['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'CANCELLED'] as const), ...readPagination(page, pageSize) }));
  }

  @Post('refund-requests/:refundRequestId/approve')
  async approveRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => approveRefundRequest({ database, adminProfileId: profile.id, refundRequestId, ticketRefundKobo: readInteger(body, 'ticketRefundKobo'), platformFeeRefundKobo: readInteger(body, 'platformFeeRefundKobo'), reason: readString(body, 'reason'), now: new Date() }));
    return { approved: true };
  }

  @Post('refund-requests/:refundRequestId/reject')
  async rejectRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => rejectRefundRequest({ database, adminProfileId: profile.id, refundRequestId, reason: readString(body, 'reason'), now: new Date() }));
    return { rejected: true };
  }

  @Post('refund-requests/:refundRequestId/mark-processed')
  async processRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => markRefundProcessed({ database, adminProfileId: profile.id, refundRequestId, gatewayRefundReference: readString(body, 'gatewayRefundReference'), gatewayStatus: readString(body, 'gatewayStatus'), now: new Date() }));
    return { processed: true };
  }

  @Post('refund-requests/:refundRequestId/execute')
  async executeRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => executeApprovedRefund({ database, adminProfileId: profile.id, refundRequestId, gateway: configuredPaystackGateway(), now: new Date() }));
  }

  @Post('refund-requests/:refundRequestId/reconcile')
  async reconcileRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => reconcileExecutedRefund({ database, adminProfileId: profile.id, refundRequestId, gateway: configuredPaystackGateway(), now: new Date() }));
  }

  @Get('payout-requests')
  async payouts(@Req() request: Request, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => pageAdministrationPayoutRequests({ database, adminProfileId: profile.id, status: readOptionalEnum(status, ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'] as const), ...readPagination(page, pageSize) }));
  }

  @Post('payout-requests/:payoutRequestId/approve')
  async approvePayout(@Req() request: Request, @Param('payoutRequestId') payoutRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => approvePayoutRequest({ database, adminProfileId: profile.id, payoutRequestId, reason: readString(body, 'reason'), now: new Date() }));
    return { approved: true };
  }

  @Post('payout-requests/:payoutRequestId/reject')
  async rejectPayout(@Req() request: Request, @Param('payoutRequestId') payoutRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => rejectPayoutRequest({ database, adminProfileId: profile.id, payoutRequestId, reason: readString(body, 'reason'), now: new Date() }));
    return { rejected: true };
  }

  @Post('payout-requests/:payoutRequestId/mark-paid')
  async payPayout(@Req() request: Request, @Param('payoutRequestId') payoutRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    await this.withDatabase((database) => markPayoutPaid({ database, adminProfileId: profile.id, payoutRequestId, transferReference: readString(body, 'transferReference'), transferDate: readDate(body, 'transferDate'), now: new Date() }));
    return { paid: true };
  }

  @Get('platform-fee-rule')
  async platformFeeRule(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    return this.withDatabase((database) => getActivePlatformFeeRule({ database, adminProfileId: profile.id, now: new Date() }));
  }

  @Put('platform-fee-rule')
  async replacePlatformFee(@Req() request: Request, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ADMIN');
    const record = asRecord(body);
    const mode = record.mode;
    if (mode !== 'FIXED' && mode !== 'PERCENTAGE') throw new BadRequestException('mode is invalid');
    return this.withDatabase((database) => replacePlatformFeeRule({ database, adminProfileId: profile.id, mode, fixedAmountKobo: optionalInteger(record.fixedAmountKobo), percentageBasisPoints: optionalInteger(record.percentageBasisPoints), effectiveAt: readDate(body, 'effectiveAt'), reason: readString(body, 'reason'), now: new Date() }));
  }

}

function configuredPaystackGateway() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new ServiceUnavailableException('payments are not configured');
  return createPaystackGateway({ secretKey });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new BadRequestException('request body is invalid');
  return value as Record<string, unknown>;
}

function readString(body: unknown, field: string): string {
  const value = asRecord(body)[field];
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value;
}

function readInteger(body: unknown, field: string): number {
  const value = asRecord(body)[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException(`${field} is invalid`);
  return value;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException('fee amount is invalid');
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is invalid`);
  return value;
}

function readBoolean(body: unknown, field: string): boolean {
  const value = asRecord(body)[field];
  if (typeof value !== 'boolean') throw new BadRequestException(`${field} is invalid`);
  return value;
}

function readDate(body: unknown, field: string): Date {
  const value = asRecord(body)[field];
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is invalid`);
  return date;
}

function readOptionalEnum<const T extends readonly string[]>(value: string | undefined, values: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new BadRequestException('filter is invalid');
  return value as T[number];
}
