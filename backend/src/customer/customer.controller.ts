import { ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { getCustomerTicket, getCustomerTicketDocument, getCustomerTicketDownload, listCustomerOrders, requestOrderConfirmationResend } from './customer-ticket-access.js';
import { readCustomerOrderHistoryQuery } from './customer-order-history-query.js';

const runCustomerDatabaseOperation = createDatabaseOperation('customer access is not configured');

@ApiTags('Account')
@ApiBearerAuth('session')
@Controller('customer')
export class CustomerController {
  @Get('orders')
  async orders(@Req() request: Request, @Query('status') status: unknown, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const query = readCustomerOrderHistoryQuery(status, page, pageSize);
    return runCustomerDatabaseOperation((database) => listCustomerOrders({ database, customerProfileId: profile.id, ...query }));
  }

  @Get('tickets/:ticketId')
  async ticket(@Req() request: Request, @Param('ticketId') ticketId: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    return runCustomerDatabaseOperation((database) => getCustomerTicket({ database, customerProfileId: profile.id, ticketId, admissionTokenSecret: process.env.ADMISSION_TOKEN_SECRET ?? '' }));
  }

  @Get('tickets/:ticketId/download')
  async downloadIntent(@Req() request: Request, @Param('ticketId') ticketId: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const document = await runCustomerDatabaseOperation((database) => getCustomerTicketDocument({ database, customerProfileId: profile.id, ticketId }));
    if (!document) throw new NotFoundException('ticket document was not found');
    if (document.status !== 'READY') throw new ConflictException('ticket document is not ready');
    const [{ createR2ObjectStore }, { readR2Config }] = await Promise.all([
      import('../worker/r2-object-store.js'),
      import('../worker/worker-config.js'),
    ]);
    const objectStore = createR2ObjectStore({ config: readR2Config(process.env) });
    const download = await runCustomerDatabaseOperation((database) => getCustomerTicketDownload({
      database,
      customerProfileId: profile.id,
      ticketId,
      createDownloadUrl: (objectKey) => objectStore.createPrivateDownloadUrl({ objectKey }),
    }));
    if (!download) throw new NotFoundException('ticket document was not found');
    return download;
  }

  @Post('orders/:orderReference/resend-confirmation')
  async resendConfirmation(@Req() request: Request, @Param('orderReference') orderReference: string) {
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const notification = await runCustomerDatabaseOperation((database) => requestOrderConfirmationResend({ database, customerProfileId: profile.id, orderReference }));
    if (!notification) throw new NotFoundException('paid order was not found');
    return { queued: true };
  }

}
