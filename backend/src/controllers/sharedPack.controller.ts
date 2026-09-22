import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SHARED_PACK_ROUTES } from '../routes/sharedPack.routes';
import { SharedPackService } from '../services/sharedPack.service';
import type { AuthUser, CreateSharedPackInput } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('shared-packs')
@Controller(SHARED_PACK_ROUTES.root)
export class SharedPackController {
  constructor(private readonly sharedPackService: SharedPackService) {}

  @Get(SHARED_PACK_ROUTES.mine)
  async findMine(@Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharedPackService.findMine(req.user as AuthUser));
  }

  @Get(SHARED_PACK_ROUTES.detail)
  async findOne(@Param('id') id: string, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharedPackService.findOneForCreator(id, req.user as AuthUser));
  }

  @Post()
  async create(@Body() payload: CreateSharedPackInput, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharedPackService.createPack(payload, req.user as AuthUser), '共享素材包已生成');
  }

  @Post(SHARED_PACK_ROUTES.revoke)
  async revoke(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @Req() req: Request & { user?: AuthUser },
  ) {
    return ok(await this.sharedPackService.revoke(id, req.user as AuthUser, reason), '共享素材包已撤销');
  }

  @Post(SHARED_PACK_ROUTES.claim)
  async claim(@Param('code') code: string, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharedPackService.claim(code, req.user as AuthUser), '领取成功');
  }
}
