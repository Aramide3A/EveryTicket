import { ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { getCustomerOrder, getCustomerTicket, getCustomerTicketDocument, getCustomerTicketDownload, listCustomerOrders, listCustomerTickets } from './customer-ticket-access.js';
import { readCustomerOrderHistoryQuery } from './customer-order-history-query.js';
import { upgradeProfileToOrganizer } from '../identity/organizer-upgrade.js';

const runAccountDatabaseOperation = createDatabaseOperation('customer access is not configured');

@ApiTags('Account')
@ApiBearerAuth('session')
@Controller('account')
export class AccountController {
  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated application profile' })
  async me(@Req() request: Request) {
    const profile = await requireActiveProfile(request);
    return { id: profile.id, role: profile.role, roles: profile.roles, status: 'ACTIVE' as const };
  }

  @Post('organizer')
  @ApiOperation({ summary: 'Upgrade the authenticated customer profile to organizer' })
  async becomeOrganizer(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    return runAccountDatabaseOperation((database) => upgradeProfileToOrganizer({ database, profileId: profile.id }));
  }

  @Get('orders')
  @ApiOperation({ summary: 'List the authenticated customer orders' })
  async orders(@Req() request: Request, @Query('status') status: unknown, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const query = readCustomerOrderHistoryQuery(status, page, pageSize);
    return runAccountDatabaseOperation((database) => listCustomerOrders({ database, customerProfileId: profile.id, ...query }));
  }

  @Get('orders/:orderReference')
  @ApiOperation({ summary: 'Get one authenticated customer order' })
  async order(@Req() request: Request, @Param('orderReference') orderReference: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const order = await runAccountDatabaseOperation((database) => getCustomerOrder({ database, customerProfileId: profile.id, orderReference }));
    if (!order) throw new NotFoundException('order was not found');
    return order;
  }

  @Get('tickets')
  @ApiOperation({ summary: 'List the authenticated customer tickets' })
  async tickets(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    return runAccountDatabaseOperation((database) => listCustomerTickets({ database, customerProfileId: profile.id, admissionTokenSecret: process.env.ADMISSION_TOKEN_SECRET ?? '' }));
  }

  @Get('tickets/:ticketId')
  @ApiOperation({ summary: 'Get one authenticated customer ticket' })
  async ticket(@Req() request: Request, @Param('ticketId') ticketId: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const ticket = await runAccountDatabaseOperation((database) => getCustomerTicket({ database, customerProfileId: profile.id, ticketId, admissionTokenSecret: process.env.ADMISSION_TOKEN_SECRET ?? '' }));
    if (!ticket) throw new NotFoundException('ticket was not found');
    return ticket;
  }

  @Get('tickets/:ticketId/download')
  @ApiOperation({ summary: 'Create a short-lived private ticket download URL' })
  async download(@Req() request: Request, @Param('ticketId') ticketId: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const document = await runAccountDatabaseOperation((database) => getCustomerTicketDocument({ database, customerProfileId: profile.id, ticketId }));
    if (!document) throw new NotFoundException('ticket document was not found');
    if (document.status !== 'READY') throw new ConflictException('ticket document is not ready');
    const [{ createR2ObjectStore }, { readR2Config }] = await Promise.all([
      import('../worker/r2-object-store.js'),
      import('../worker/worker-config.js'),
    ]);
    const objectStore = createR2ObjectStore({ config: readR2Config(process.env) });
    const download = await runAccountDatabaseOperation((database) => getCustomerTicketDownload({
      database,
      customerProfileId: profile.id,
      ticketId,
      createDownloadUrl: (objectKey) => objectStore.createPrivateDownloadUrl({ objectKey }),
    }));
    if (!download) throw new NotFoundException('ticket document was not found');
    return download;
  }
}
