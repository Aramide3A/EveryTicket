import { BadRequestException, Body, ConflictException, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { organizerRegistrationRoles, registrationCookies } from './organizer-registration.js';

@ApiTags('Organizer registration')
@Controller('organizer-registration')
export class OrganizerRegistrationController {
  @Post()
  @ApiOperation({ summary: 'Create an organizer account with email and password' })
  @ApiBody({ schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } } } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { name, email, password } = readRegistration(body);
    const { auth, authDatabase } = await import('../identity/auth.js');
    const result = await auth.api.signUpEmail({ body: { name, email, password }, returnHeaders: true });
    const registration = result.response;
    const createdProfile = await authDatabase.applicationProfile.findUnique({
      where: { userId: registration.user.id },
      select: { id: true },
    });
    if (!createdProfile) throw new ConflictException('organizer registration could not be completed');
    let profile;
    try {
      profile = await authDatabase.applicationProfile.update({
        where: { userId: registration.user.id },
        data: { role: 'ORGANIZER', roles: organizerRegistrationRoles() },
        select: { id: true, role: true, roles: true },
      });
    } catch (error) {
      await authDatabase.auth_user.deleteMany({ where: { id: registration.user.id } });
      throw error;
    }
    const cookies = registrationCookies(result.headers);
    if (cookies.length) response.setHeader('set-cookie', cookies);
    return { user: registration.user, profile };
  }
}

function readRegistration(body: unknown): { name: string; email: string; password: string } {
  if (typeof body !== 'object' || body === null) throw new BadRequestException('name, email, and password are required');
  const value = body as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim() || typeof value.email !== 'string' || !value.email.trim() || typeof value.password !== 'string' || !value.password) {
    throw new BadRequestException('name, email, and password are required');
  }
  return { name: value.name.trim(), email: value.email.trim().toLowerCase(), password: value.password };
}
