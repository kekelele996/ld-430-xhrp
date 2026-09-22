import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SHARE_PACK_ROUTES } from '../routes/sharePack.routes';
import { SharePackService } from '../services/sharePack.service';
import { UserRole } from '../types/enums';
import type { AuthUser, CreateSharePackPayload } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('share-packs')
@Controller(SHARE_PACK_ROUTES.root)
export class SharePackController {
  constructor(private readonly sharePackService: SharePackService) {}

  @Post()
  async create(@Req() req: Request & { user?: AuthUser }, @Body() payload: CreateSharePackPayload) {
    return ok(await this.sharePackService.create(this.actor(req), payload), '共享素材包已创建');
  }

  @Get(SHARE_PACK_ROUTES.mine)
  async findMine(@Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharePackService.findMine(this.actor(req)));
  }

  @Post(SHARE_PACK_ROUTES.claim)
  async claim(@Req() req: Request & { user?: AuthUser }, @Body('code') code: string) {
    return ok(await this.sharePackService.claim(code, this.actor(req)), '领取成功');
  }

  @Get(SHARE_PACK_ROUTES.byId)
  async findOne(@Param('id') id: string, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharePackService.findOneForCreator(id, this.actor(req)));
  }

  @Post(SHARE_PACK_ROUTES.revoke)
  async revoke(@Param('id') id: string, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.sharePackService.revoke(id, this.actor(req)), '素材包已撤销');
  }

  private actor(req: Request & { user?: AuthUser }): AuthUser {
    return req.user ?? { id: 'anonymous', role: UserRole.Viewer };
  }
}
